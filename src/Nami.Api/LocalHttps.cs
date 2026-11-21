using System.Diagnostics;

internal static class LocalHttps
{
    public static bool Configure(ConfigurationManager configuration)
    {
        if (!string.IsNullOrEmpty(configuration[WebHostDefaults.ServerUrlsKey]) ||
            !string.IsNullOrEmpty(configuration[WebHostDefaults.HttpPortsKey]) ||
            !string.IsNullOrEmpty(configuration[WebHostDefaults.HttpsPortsKey]) ||
            configuration.GetSection("Kestrel:Endpoints").GetChildren().Any())
            return true;

        configuration[WebHostDefaults.ServerUrlsKey] = "https://localhost:5080";
        if (configuration.GetSection("Kestrel:Certificates").GetChildren().Any() ||
            RunDevCerts("--check", "--trust", "--quiet"))
            return true;

        Console.WriteLine("Setting up the local HTTPS certificate. Approve the trust prompt if one appears.");
        if (RunDevCerts("--trust"))
            return true;

        if (RunDevCerts("--check", "--quiet"))
        {
            Console.Error.WriteLine("NAMI can use the local certificate. Follow the .NET trust instructions above if your browser warns about it.");
            return true;
        }

        Console.Error.WriteLine("NAMI needs a local HTTPS certificate. Resolve the .NET certificate error above and run NAMI again.");
        return false;
    }

    private static bool RunDevCerts(params string[] arguments)
    {
        var startInfo = new ProcessStartInfo("dotnet") { UseShellExecute = false };
        startInfo.ArgumentList.Add("dev-certs");
        startInfo.ArgumentList.Add("https");
        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        using var process = Process.Start(startInfo)!;
        process.WaitForExit();
        return process.ExitCode == 0;
    }
}
