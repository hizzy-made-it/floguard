
/* ================= DATA ================= */
const SEED = [];
const SERVICE = [["Property management company", "PropertyMgmt"], ["HOA management", "PropertyMgmt"], ["Real estate brokerage", "Referral Partner"], ["Home inspector", "Referral Partner"], ["Landscaping company", "Referral Partner"], ["Home builder", "Referral Partner"], ["Pool contractor", "Referral Partner"], ["Pressure washing service", "Referral Partner"], ["Vacation rental management", "PropertyMgmt"]];
const CITIES = ["Port Orange", "Daytona Beach", "New Smyrna Beach", "Ormond Beach", "Sanford", "Orlando", "DeLand", "Deltona", "Lake Mary", "Winter Park", "Edgewater", "DeBary"];
const LISTS=['FrenchDrain','SumpPump','YardDrainage','Maintenance','PropertyMgmt'];
/** People-facing cause names (R2: the drawer and messages showed the internal keys, e.g. "FrenchDrain"). */
const CAUSE_LABEL={FrenchDrain:'French drains',SumpPump:'Sump pumps',YardDrainage:'Yard drainage',Maintenance:'Maintenance',PropertyMgmt:'Property mgmt'};
function causeLabel(c){ return CAUSE_LABEL[c]||String(c||''); }
const LIST_SHORT={FrenchDrain:'FD',SumpPump:'Sump',YardDrainage:'Yard',Maintenance:'Mnt',PropertyMgmt:'PM'};
/** Industry-based cause suggestions — create/import/seed only, never re-applied on render. */
function suggestListsForIndustry(industry, website){
 const out=[];
 const ind=(industry||'').toLowerCase();
 if(/property management|hoa|realtor|real estate|landlord|rental/.test(ind)){
 out.push('PropertyMgmt');
 }
 if(/crawl ?space|sump|pump|foundation/.test(ind)){
 out.push('SumpPump');
 }
 if(/lanai|patio|driveway|grading|erosion|landscap|yard/.test(ind)){
 out.push('YardDrainage');
 }
 if(/maintenance|service plan|inspection|monitoring/.test(ind)){
 out.push('Maintenance');
 }
 return out.filter(function(x,i){ return out.indexOf(x)===i && LISTS.includes(x); });
}
const KEY='floguard_leads_v1', CFGKEY='floguard_desk_cfg', CHATKEY='floguard_desk_chats';
const MGMTKEY='floguard_mgmt_companies_v1';
