"use strict";
// Documentation only. Never dispatches a Lightroom action or copies a stale request.
(async function () {
    const host = document.getElementById("httpInventory");
    if (!host) return;
    try {
        const response = await fetch("/api/help", { cache: "no-store" });
        if (!response.ok) throw Error("API help unavailable");
        const data = (await response.json()).operationInventory;
        if (!data || !Array.isArray(data.operations)) throw Error("Operation inventory unavailable");
        const input = document.createElement("input"); input.type = "search";
        input.placeholder = "Filter operations, tools or routes"; input.setAttribute("aria-label", "Filter HTTP operation inventory");
        const showInternal = document.createElement("input"); showInternal.type = "checkbox";
        const label = document.createElement("label"); label.append(showInternal, " Include internal plug-in protocol");
        const list = document.createElement("div"); list.className = "http-operation-list";
        function render() {
            const query = input.value.trim().toLowerCase(); list.replaceChildren();
            const groups = new Map();
            for (const item of data.operations) {
                if (item.kind === "internal" && !showInternal.checked || !`${item.group} ${item.path} ${item.kind}`.toLowerCase().includes(query)) continue;
                if (!groups.has(item.group)) groups.set(item.group, []); groups.get(item.group).push(item);
            }
            for (const [group, items] of groups) {
                const details = document.createElement("details"); details.open = !!query;
                const summary = document.createElement("summary"); summary.textContent = group + " (" + items.length + ")"; details.append(summary);
                for (const item of items) {
                    const p = document.createElement("p"), code = document.createElement("code"), note = document.createElement("span");
                    code.textContent = item.method + " " + item.path;
                    note.textContent = " — " + item.kind + ": " + data.notes[item.kind]; p.append(code, note); details.append(p);
                }
                list.append(details);
            }
            if (!groups.size) list.textContent = "No matching operations.";
        }
        input.addEventListener("input",render); showInternal.addEventListener("change",render);
        host.replaceChildren(input,label,list); render();
    } catch (error) { host.textContent = error.message + ". See the included HTTP_OPERATIONS.md reference."; }
})();
