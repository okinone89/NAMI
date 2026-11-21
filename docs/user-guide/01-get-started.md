# 1. Get started

## Start a local workspace

Install Git, the .NET 10 **SDK**, and Node.js 24 with npm. In a terminal, clone and enter the repository.

```sh
git clone https://github.com/okinone89/NAMI.git
cd NAMI
```

Run `./run --dev` on macOS or Linux, or `.\run.ps1 -Dev` in Windows PowerShell. The launcher prepares the frontend and starts NAMI. Open [http://127.0.0.1:5080](http://127.0.0.1:5080). On the first visit, create and confirm a shared editor password to open the workspace in **Edit mode**. A new database shows **No plans yet**. Stop NAMI with Ctrl+C.

The default database is `src/Nami.Api/data/nami.db`. To share a production instance over HTTPS, follow [Publish NAMI with nginx](06-installation-and-maintenance.md#publish-nami-with-nginx). See [Run and maintain an installation](06-installation-and-maintenance.md) for database and listener settings.

## Browse or edit

- In **View mode**, open plans, search, inspect components and links, and download CSV or PDF exports. To edit, select **View mode**, enter the shared editor password, and select **Unlock editing**. The first visitor sets this password in the browser. See [Set or reset the editor password](06-installation-and-maintenance.md#set-or-reset-the-editor-password).
- Select **Edit mode** to sign out. Editor sessions expire after eight hours without plan API activity.
- Use **Workspace → Open plan** to change plans or **Workspace → Edit plan** to rename the open plan. After choosing a plan from **Open plan**, share the browser address with anyone who can reach this instance. The workspace follows your system theme on first use. Use **Workspace** to remember a light or dark preference.

**Diagram** and **Table** show the same plan. Select one or more **Networks** tiles to focus both views, or select them again to clear that filter. This browser remembers the search and network filters per plan.

## Build your first plan

1. In **Edit mode**, choose **Workspace → New plan**. Enter `Cartoning line` and select **Create plan**.
2. Choose **Add network**. Name it `Machine LAN`, set **IPv4 network address** to `192.0.2.0` and **Subnet mask** to `255.255.255.0`, and select **Save network**. The network tile displays `192.0.2.0/24`.
3. From **Diagram**, choose **Add → Add component**. Name it `Cartoner PLC` and set its type to `PLC`. Choose **Add interface**, name the interface `X1`, pick **Machine LAN**, enter `192.0.2.10`, and select **Save component**. Repeat for `Operator panel` of type `HMI` with interface `LAN` and address `192.0.2.20`.
4. Choose **Add → Add link**. Select the PLC and its X1 interface as the source and the operator panel and its LAN interface as the target. Choose **Wired** under **Medium**, optionally enter a link protocol, then select **Save link**. Drag the components apart if you want to change the layout.
5. Switch to **Table** and search for `192.0.2.10`. Clear the search to see both rows. To share the plan, choose **Workspace → Export → PDF**, set **Include** to **Diagram and table** and **Export scope** to **Whole plan**, then select **Download PDF**.

The rest of the guide uses an expanded version of this plan.
