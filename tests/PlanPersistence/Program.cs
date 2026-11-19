using Microsoft.Extensions.Configuration;
using Nami.Api.Plans;

var configuration = new ConfigurationBuilder().AddEnvironmentVariables().Build();
var store = new PlanStore(configuration, Directory.GetCurrentDirectory());

switch (args[0])
{
    case "create":
        await CreateMachineAndLineAsync();
        break;
    case "reload":
        await ReloadMachineAndLineAsync();
        await EditTopologyAsync();
        break;
    case "verify-edits":
        await VerifyTopologyEditsAsync();
        await RejectReferencesOutsidePlanAsync();
        await RejectStaleSaveAsync();
        break;
    case "legacy":
        await ReadExistingPlanAsync();
        break;
    default:
        throw new ArgumentException("Unknown persistence test phase.");
}

async Task CreateMachineAndLineAsync()
{
    var machine = await store.CreateAsync("Standalone filler");
    var line = await store.CreateAsync("Packaging line");
    Check(machine.Id != line.Id, "New plans have distinct identities.");
    var isolatedMachine = machine with
    {
        Networks = [new("machine-net", "Machine LAN", "192.168.1.0/24")],
        Components = [new("filler-plc", "Filler PLC", "plc"), new("machine-host", "Machine server", "server")],
        Interfaces = [new("filler-plc-lan", "filler-plc", "LAN", "machine-net", "192.168.1.10")]
    };
    var packagingLine = line with
    {
        Networks = [
            new("plant", "Plant", "192.168.1.0/24"),
            new("machine-cell", "Machine LAN", "192.168.1.0/24")
        ],
        Components = [
            new("main-switch", "Main switch", "switch"),
            new("capper-plc", "Capper PLC", "plc"),
            new("server-a", "Server A", "server"),
            new("server-b", "Server B", "server"),
            new("historian", "Historian", "vm", HostId: "server-a")
        ],
        Interfaces = [
            new("switch-port", "main-switch", "Port 1", "plant"),
            new("switch-management", "main-switch", "Management", "plant", "192.168.1.10"),
            new("capper-plc-lan", "capper-plc", "LAN", "machine-cell", "192.168.1.10"),
            new("historian-lan", "historian", "LAN", "plant", "192.168.1.20"),
            new("historian-backup", "historian", "Backup", "plant")
        ],
        Links = [
            new("capper-link", new("capper-plc"), new("main-switch"), LinkMedium.Wired, "EtherNet/IP"),
            new("wireless-link", new("server-a"), new("main-switch"), LinkMedium.Wireless),
            new("virtual-link", new("historian", "historian-lan"), new("server-a"), LinkMedium.Virtual)
        ]
    };
    Check(await store.SaveAsync(isolatedMachine), "The standalone machine topology saves.");
    Check(await store.SaveAsync(packagingLine), "The packaging line topology saves.");
    Console.WriteLine($"{machine.Id}\n{line.Id}");
}

async Task ReloadMachineAndLineAsync()
{
    var plans = await store.ListAsync();
    Check(plans.Count == 2, "Both plans are listed after restart.");
    var machine = await LoadPlanAsync(args[1]);
    var line = await LoadPlanAsync(args[2]);
    Check(machine.Name == "Standalone filler", "The standalone machine reloads by ID.");
    Check(line.Name == "Packaging line", "The line reloads by ID.");
    Check(machine.Networks.Single() == new PlanNetwork("machine-net", "Machine LAN", "192.168.1.0/24"),
        "The standalone machine retains its own network identity.");
    Check(line.Networks.Single(network => network.Id == "machine-cell").Subnet == "192.168.1.0/24",
        "Isolated networks can have identical subnets.");
    Check(line.Components.Single(component => component.Id == "main-switch") ==
        new Component("main-switch", "Main switch", "switch"), "The switch retains its ID, name and type.");
    Check(line.Interfaces.Single(port => port.Id == "switch-port") ==
        new PlanInterface("switch-port", "main-switch", "Port 1", "plant"),
        "A switch port keeps network membership without an IP.");
    Check(line.Interfaces.Single(port => port.Id == "switch-management") ==
        new PlanInterface("switch-management", "main-switch", "Management", "plant", "192.168.1.10"),
        "The same switch's management interface has an independent IP.");
    Check(machine.Interfaces.Single().Ipv4 == "192.168.1.10" &&
        line.Interfaces.Single(port => port.Id == "capper-plc-lan").Ipv4 == "192.168.1.10",
        "Identical addresses are kept across isolated networks and plans.");
}

async Task EditTopologyAsync()
{
    var line = await LoadPlanAsync(args[2]);
    Check(line.Links.Single(link => link.Id == "capper-link") ==
        new PlanLink("capper-link", new("capper-plc"), new("main-switch"), LinkMedium.Wired, "EtherNet/IP"),
        "A wired link can start with both ports unknown.");
    Check(line.Components.Single(component => component.Id == "historian").HostId == "server-a",
        "The VM is initially hosted on Server A.");
    var edited = line with
    {
        Name = "Packaging line north",
        Networks = line.Networks.Select(network => network.Id == "plant"
            ? network with { Name = "Plant floor", Position = new(40, -25) } : network).ToArray(),
        Components = line.Components.Select(component => component.Id switch
        {
            "main-switch" => component with { Name = "Main switch north", Position = new(150.5, 200) },
            "historian" => component with { HostId = "server-b" },
            _ => component
        }).ToArray(),
        Interfaces = line.Interfaces.Select(port => port.Id == "switch-management"
            ? port with { Ipv4 = "192.168.1.15" } : port).ToArray(),
        Links = line.Links.Select(link => link.Id == "capper-link"
            ? link with { Source = new("capper-plc", "capper-plc-lan"), Target = new("main-switch", "switch-port") }
            : link).ToArray()
    };
    Check(await store.SaveAsync(edited), "Renames, position changes, port refinements and rehosting save together.");
}

async Task VerifyTopologyEditsAsync()
{
    var line = await LoadPlanAsync(args[2]);
    Check(line.Name == "Packaging line north", "Plan renaming preserves its ID.");
    Check(line.Networks.Single(network => network.Id == "plant") ==
        new PlanNetwork("plant", "Plant floor", "192.168.1.0/24", new(40, -25)),
        "Network renaming and moving preserve its ID.");
    Check(line.Components.Single(component => component.Id == "main-switch") ==
        new Component("main-switch", "Main switch north", "switch", new(150.5, 200)),
        "Component renaming and moving preserve its ID.");
    Check(line.Interfaces.Single(port => port.Id == "switch-management") ==
        new PlanInterface("switch-management", "main-switch", "Management", "plant", "192.168.1.15"),
        "Readdressing preserves interface identity and network membership through renames.");
    Check(line.Links.Single(link => link.Id == "capper-link") ==
        new PlanLink("capper-link", new("capper-plc", "capper-plc-lan"), new("main-switch", "switch-port"),
            LinkMedium.Wired, "EtherNet/IP"),
        "Refining both endpoints preserves the link ID and medium independently of protocol.");
    Check(line.Links.Single(link => link.Id == "wireless-link") ==
        new PlanLink("wireless-link", new("server-a"), new("main-switch"), LinkMedium.Wireless),
        "A wireless link reloads without a protocol.");
    Check(line.Links.Single(link => link.Id == "virtual-link") ==
        new PlanLink("virtual-link", new("historian", "historian-lan"), new("server-a"), LinkMedium.Virtual),
        "Changing hosts preserves the VM's separate virtual link.");
    Check(line.Components.Single(component => component.Id == "historian") ==
        new Component("historian", "Historian", "vm", HostId: "server-b"),
        "The independently identified VM reloads on Server B.");
    Check(line.Interfaces.Where(port => port.ComponentId == "historian").SequenceEqual(new PlanInterface[]
    {
        new("historian-lan", "historian", "LAN", "plant", "192.168.1.20"),
        new("historian-backup", "historian", "Backup", "plant")
    }), "Rehosting preserves both VM interfaces, their membership and their address state.");
}

async Task RejectReferencesOutsidePlanAsync()
{
    var line = await LoadPlanAsync(args[2]);
    await RejectSaveAsync(line with
    {
        Interfaces = [.. line.Interfaces, new("other-network", "main-switch", "Other", "machine-net")]
    }, "An interface cannot join a network in another plan.");
    await RejectSaveAsync(line with
    {
        Interfaces = [.. line.Interfaces, new("other-component", "filler-plc", "Other")]
    }, "An interface cannot belong to a component in another plan.");
    await RejectSaveAsync(line with
    {
        Components = [.. line.Components, new("other-vm", "Other VM", "vm", HostId: "machine-host")]
    }, "A VM cannot be hosted on a server in another plan.");
    await RejectSaveAsync(line with
    {
        Links = [.. line.Links, new("other-component", new("filler-plc"), new("main-switch"), LinkMedium.Wired)]
    }, "A link cannot reference a component in another plan.");
    await RejectSaveAsync(line with
    {
        Links = [.. line.Links, new("other-interface", new("main-switch"), new("capper-plc", "filler-plc-lan"), LinkMedium.Wired)]
    }, "A link cannot reference an interface in another plan.");
    await RejectSaveAsync(line with
    {
        Links = [.. line.Links, new("wrong-interface", new("capper-plc", "switch-port"), new("main-switch"), LinkMedium.Wired)]
    }, "A link endpoint cannot combine a component with a port on another component.");

    await RejectSaveAsync(line with
    {
        Networks = [.. line.Networks, new("plant", "Duplicate identity")]
    }, "Two networks in the same plan cannot share an ID.");

    var saved = await LoadPlanAsync(line.Id);
    Check(saved.Revision == line.Revision && saved.Name == line.Name,
        "Rejected references leave the existing snapshot intact.");
}

async Task RejectSaveAsync(Plan invalid, string message)
{
    try
    {
        await store.SaveAsync(invalid with { Name = "Invalid edit" });
    }
    catch (ArgumentException)
    {
        return;
    }
    throw new InvalidOperationException(message);
}

async Task RejectStaleSaveAsync()
{
    var snapshot = await LoadPlanAsync(args[2]);
    var staleEdit = snapshot with
    {
        Name = "Stale edit",
        Networks = snapshot.Networks.Select(network => network with { Name = "Stale network name" }).ToArray()
    };

    Check(await store.SaveAsync(snapshot with { Name = "Saved first" }), "A current revision can be saved.");
    Check(!await store.SaveAsync(staleEdit), "An editor cannot save a superseded revision.");

    var saved = await LoadPlanAsync(snapshot.Id);
    Check(saved.Revision == snapshot.Revision + 1 && saved.Name == "Saved first" &&
        saved.Networks.SequenceEqual(snapshot.Networks), "A stale save leaves the latest revision and topology intact.");
}

async Task ReadExistingPlanAsync()
{
    var plan = await LoadPlanAsync(args[1]);
    Check(plan.Name == "Assembly" && plan.Revision == 0,
        "A plan created before topology support is readable with its original ID and name.");
    Check(plan.Networks.Count == 0 && plan.Components.Count == 0 &&
        plan.Interfaces.Count == 0 && plan.Links.Count == 0,
        "An upgraded plan starts with empty topology.");
}

async Task<Plan> LoadPlanAsync(string id) =>
    await store.GetAsync(id) ?? throw new InvalidOperationException("Expected to reload the plan.");

static void Check(bool condition, string message)
{
    if (!condition)
        throw new InvalidOperationException(message);
}
