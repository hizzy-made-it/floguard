/**
 * Run in the browser console on the FloGuard CRM (/crm/) to export the
 * localStorage lead list as JSON. Save output as data/exports/leads.json then:
 *   leadagent import-leads data/exports/leads.json
 *
 * NOTE: superseded by the server sync — `leadagent sync pull` fetches the shared
 * store directly (see README "Sync with the FloGuard CRM"). Keep this only as an
 * offline fallback for a browser that never synced.
 *
 * Keys below must match public/crm/index.html (KEY = 'floguard_leads_v1').
 */
(function () {
  const KEYS = ["floguard_leads_v1"];
  let data = null;
  for (const k of KEYS) {
    const raw = localStorage.getItem(k);
    if (raw) {
      try {
        data = JSON.parse(raw);
        console.log("Found key:", k, "count:", data.length);
        break;
      } catch (e) {}
    }
  }
  if (!data) {
    console.warn("No leads in localStorage.");
    return;
  }
  const blob = new Blob([JSON.stringify({ leads: data }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "floguard_leads_export.json";
  a.click();
  console.log("Download started. Import with: leadagent import-leads <file>");
})();
