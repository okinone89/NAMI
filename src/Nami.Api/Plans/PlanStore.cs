using System.Data.Common;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Nami.Api.Plans;

public sealed class PlanStore(IConfiguration configuration, string contentRoot)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public Task<Plan> CreateAsync(string name, CancellationToken cancellationToken = default) =>
        InsertAsync(new Plan(Guid.NewGuid().ToString(), name, 0), cancellationToken);

    internal async Task<Plan> InsertAsync(Plan plan, CancellationToken cancellationToken)
    {
        PlanValidation.Validate(plan);
        InventoryNames.Validate(plan);
        // A package carries already recorded addresses, including duplicates that remain flagged.
        var issues = AddressValidation.Inspect(plan).Where(issue => issue.Code != AddressIssueCode.DuplicateIpv4).ToArray();
        if (issues.Length > 0)
            throw new AddressValidationException(issues);

        await using var database = Database.Open(configuration, contentRoot);
        await using var command = database.CreateCommand();
        command.CommandText = "INSERT INTO plans (id, name, topology) VALUES (@id, @name, @topology)";
        AddParameter(command, "id", plan.Id);
        AddParameter(command, "name", plan.Name);
        AddParameter(command, "topology", SerializeTopology(plan));
        await command.ExecuteNonQueryAsync(cancellationToken);
        return plan;
    }

    public async Task<IReadOnlyList<PlanSummary>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using var database = Database.Open(configuration, contentRoot);
        await using var command = database.CreateCommand();
        command.CommandText = "SELECT id, name FROM plans ORDER BY name, id";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var plans = new List<PlanSummary>();
        while (await reader.ReadAsync(cancellationToken))
            plans.Add(new PlanSummary(reader.GetString(0), reader.GetString(1)));

        return plans;
    }

    public async Task<Plan?> GetAsync(string id, CancellationToken cancellationToken = default)
    {
        await using var database = Database.Open(configuration, contentRoot);
        await using var command = database.CreateCommand();
        command.CommandText = "SELECT name, revision, topology, inventory_undo FROM plans WHERE id = @id";
        AddParameter(command, "id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return null;

        var plan = new Plan(id, reader.GetString(0), reader.GetInt64(1));
        if (reader.IsDBNull(2))
            return plan;

        var topology = JsonSerializer.Deserialize<PlanTopology>(reader.GetString(2), JsonOptions)
            ?? throw new InvalidOperationException("The saved plan topology is missing.");
        return topology.ApplyTo(plan with
        {
            InventoryUndo = reader.IsDBNull(3)
                ? null
                : JsonSerializer.Deserialize<InventoryUndoReceipt>(reader.GetString(3), JsonOptions)
        });
    }

    // An unsuccessful save means the plan is missing or its revision has changed.
    public Task<bool> SaveAsync(Plan plan, CancellationToken cancellationToken = default) =>
        SaveAsync(plan, [], cancellationToken);

    public async Task<bool> SaveAsync(Plan plan, IReadOnlyList<AddressConflictApproval> approvals,
        CancellationToken cancellationToken = default) =>
        await SaveSnapshotAsync(plan, approvals, cancellationToken) is not null;

    internal Task<Plan?> SaveSnapshotAsync(Plan plan, IReadOnlyList<AddressConflictApproval> approvals,
        CancellationToken cancellationToken, bool automaticIpAssignment = false) =>
        SaveSnapshotAsync(plan, approvals, updateInventoryUndo: false, null, cancellationToken, automaticIpAssignment);

    internal Task<Plan?> SaveInventoryAsync(Plan plan, IReadOnlyList<AddressConflictApproval> approvals,
        InventoryUndoReceipt? inventoryUndo, CancellationToken cancellationToken) =>
        SaveSnapshotAsync(plan, approvals, updateInventoryUndo: true, inventoryUndo, cancellationToken);

    private async Task<Plan?> SaveSnapshotAsync(Plan plan, IReadOnlyList<AddressConflictApproval> approvals,
        bool updateInventoryUndo, InventoryUndoReceipt? inventoryUndo, CancellationToken cancellationToken,
        bool automaticIpAssignment = false)
    {
        PlanValidation.Validate(plan);
        var current = await GetAsync(plan.Id, cancellationToken);
        if (current is null || current.Revision != plan.Revision)
            return null;

        InventoryNames.Validate(plan, current);
        if (automaticIpAssignment)
            plan = AddressAllocation.AssignNewAttachments(current, plan);
        var issues = AddressValidation.BlockingIssues(current, plan, approvals);
        if (issues.Count > 0)
            throw new AddressValidationException(issues);
        await using var database = Database.Open(configuration, contentRoot);
        // An explicit SQLite commit can wait for readers after the returning statement has finished.
        await using var transaction = database is SqliteConnection
            ? await database.BeginTransactionAsync(cancellationToken)
            : null;
        await using var command = database.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE plans
            SET name = @name, topology = @topology, revision = revision + 1,
                inventory_undo = CASE WHEN @updateInventoryUndo THEN NULLIF(@inventoryUndo, '') ELSE inventory_undo END
            WHERE id = @id AND revision = @revision
            RETURNING revision
            """;
        AddParameter(command, "id", plan.Id);
        AddParameter(command, "name", plan.Name);
        AddParameter(command, "topology", SerializeTopology(plan));
        AddParameter(command, "updateInventoryUndo", updateInventoryUndo);
        AddParameter(command, "inventoryUndo",
            inventoryUndo is null ? "" : JsonSerializer.Serialize(inventoryUndo, JsonOptions));
        AddParameter(command, "revision", plan.Revision);
        var result = await command.ExecuteScalarAsync(cancellationToken);
        if (result is null)
            return null;
        if (transaction is not null)
            await transaction.CommitAsync(cancellationToken);

        return plan with
        {
            Revision = (long)result,
            InventoryUndo = updateInventoryUndo ? inventoryUndo : current.InventoryUndo
        };
    }

    private static string SerializeTopology(Plan plan) => JsonSerializer.Serialize(
        new PlanTopology(plan), JsonOptions);

    private static void AddParameter(DbCommand command, string name, object value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }
}
