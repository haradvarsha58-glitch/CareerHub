"use strict";

const STAGES = ["Applied", "Screening", "Interview", "Offer", "Hired", "Rejected"];
const STORAGE = {
  account: "jrs-user",
  accounts: "jrs-accounts",
  mock: "jrs-mock-state"
};
const $ = id => document.getElementById(id);
const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[char]));
const copy = value => JSON.parse(JSON.stringify(value));

const DEFAULT_JOBS = [
  {id: 1, title: "Java Developer", company: "Kalpa Systems", city: "Pune", type: "Full-time", lpa: "6-12", skills: "Java, Spring Boot, SQL"},
  {id: 2, title: "Frontend Developer", company: "Nimbus Labs", city: "Pune", type: "Full-time", lpa: "8-14", skills: "React, CSS, TypeScript"},
  {id: 3, title: "HR Recruiter", company: "TalentBridge", city: "Mumbai", type: "Full-time", lpa: "3.5-6", skills: "Sourcing, Screening, Communication"},
  {id: 4, title: "Product Designer", company: "Northstar Digital", city: "Remote", type: "Contract", lpa: "10-16", skills: "Figma, UX Research, Prototyping"},
  {id: 5, title: "Data Analyst Intern", company: "BrightPath", city: "Bengaluru", type: "Internship", lpa: "3-5", skills: "SQL, Excel, Power BI"}
];
const DEFAULT_APPLICATIONS = [
  {id: 1, jobId: 1, name: "Riya Kulkarni", email: "riya@example.com", exp: 3, note: "Built REST APIs and production services with Java and Spring Boot.", stage: "Applied"}
];
const DEMO_ACCOUNTS = [
  {name: "Aarav Mehta", email: "candidate@jobly.in", password: "demo123", role: "candidate"},
  {name: "Priya Shah", email: "recruiter@jobly.in", password: "demo123", role: "recruiter"}
];

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    if (!storageWarningShown) {
      storageWarningShown = true;
      toast("Browser storage is unavailable; demo data will last only until this tab closes.");
    }
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    toast("Browser storage is unavailable; changes will last only until this tab closes.");
  }
}

let mode = "cand";
let filters = {query: "", city: "", type: ""};
let applyJob = null;
let recruiterJob = 0;
let jobs = [];
let applications = [];
let account = readStorage(STORAGE.account, null);
let accounts = readStorage(STORAGE.accounts, null);
let mockState = readStorage(STORAGE.mock, null);
let backendBase = null;
let authMode = "login";
let pendingApplication = false;
let renderSequence = 0;
let storageWarningShown = false;

if (!Array.isArray(accounts)) {
  accounts = copy(DEMO_ACCOUNTS);
  writeStorage(STORAGE.accounts, accounts);
}
if (!mockState || !Array.isArray(mockState.jobs) || !Array.isArray(mockState.applications)) {
  mockState = {jobs: copy(DEFAULT_JOBS), applications: copy(DEFAULT_APPLICATIONS)};
  writeStorage(STORAGE.mock, mockState);
}
if (account && (!account.email || !account.role)) {
  account = null;
}

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.style.display = "none"; }, 2800);
}

function setBackendStatus() {
  const status = $("backendStatus");
  status.textContent = backendBase ? "Connected to Java backend" : "Offline demo mode";
  status.classList.toggle("online", Boolean(backendBase));
  status.title = backendBase ? `Data is being served by ${backendBase}` : "Using saved data in this browser";
}

function makeBackendCandidates() {
  const candidates = [];
  const configured = new URLSearchParams(location.search).get("backend");
  if (configured) {
    try {
      candidates.push(new URL(configured, location.href).origin);
    } catch (error) {
      toast("The backend URL in the address bar is invalid.");
    }
  }
  if (location.protocol === "http:" || location.protocol === "https:") {
    candidates.push(location.origin);
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      candidates.push(`${location.protocol}//${location.hostname}:8080`);
    }
    if (location.hostname !== "localhost") candidates.push("http://localhost:8080");
    if (location.hostname !== "127.0.0.1") candidates.push("http://127.0.0.1:8080");
  }
  return [...new Set(candidates)];
}

async function probeBackend(base) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(`${base}/api/jobs`, {signal: controller.signal});
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data) && data.every(job => job && job.id != null && job.title) ? base : null;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function detectBackend() {
  const candidates = makeBackendCandidates();
  for (const base of candidates.slice(0, 1)) {
    const found = await probeBackend(base);
    if (found) {
      backendBase = found;
      setBackendStatus();
      return;
    }
  }
  const localCandidates = candidates.slice(1);
  if (localCandidates.length) {
    const results = await Promise.all(localCandidates.map(probeBackend));
    backendBase = results.find(Boolean) || null;
  }
  setBackendStatus();
}

function backendRequest(path, method, body) {
  return fetch(`${backendBase}/api${path}`, {
    method: method || "GET",
    headers: {"Content-Type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.isHttpError = true;
      throw error;
    }
    return data;
  });
}

function persistMockState() {
  writeStorage(STORAGE.mock, mockState);
}

function mockRequest(path, method, body) {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const query = new URLSearchParams(path.split("?")[1] || "");
  const resource = parts[0];
  const id = parts[1] ? Number(parts[1]) : null;

  if (resource === "jobs" && !id && method === "GET") return copy(mockState.jobs);
  if (resource === "jobs" && !id && method === "POST") {
    if (!String(body.title || "").trim() || !String(body.company || "").trim()) {
      throw new Error("Enter a job title and company");
    }
    const job = {
      id: Math.max(0, ...mockState.jobs.map(item => Number(item.id) || 0)) + 1,
      title: String(body.title).trim(),
      company: String(body.company).trim(),
      city: String(body.city || "Remote").trim() || "Remote",
      type: String(body.type || "Full-time"),
      lpa: String(body.lpa || "Not disclosed").trim() || "Not disclosed",
      skills: String(body.skills || "General").trim() || "General"
    };
    mockState.jobs.unshift(job);
    persistMockState();
    return copy(job);
  }
  if (resource === "jobs" && id && method === "DELETE") {
    const before = mockState.jobs.length;
    mockState.jobs = mockState.jobs.filter(job => Number(job.id) !== id);
    if (before === mockState.jobs.length) throw new Error("No job with that id");
    mockState.applications = mockState.applications.filter(application => Number(application.jobId) !== id);
    persistMockState();
    return {ok: true};
  }
  if (resource === "applications" && !id && method === "GET") {
    return copy(mockState.applications.filter(application =>
      (!query.has("jobId") || String(application.jobId) === query.get("jobId")) &&
      (!query.has("email") || application.email.toLowerCase() === query.get("email").toLowerCase())));
  }
  if (resource === "applications" && !id && method === "POST") {
    const jobId = Number(body.jobId);
    if (!mockState.jobs.some(job => Number(job.id) === jobId)) throw new Error("That job no longer exists");
    if (!String(body.name || "").trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email || ""))) {
      throw new Error("Enter your name and a valid email");
    }
    if (mockState.applications.some(application =>
      Number(application.jobId) === jobId && application.email.toLowerCase() === String(body.email).toLowerCase())) {
      throw new Error("You have already applied to this job");
    }
    const application = {
      id: Math.max(0, ...mockState.applications.map(item => Number(item.id) || 0)) + 1,
      jobId,
      name: String(body.name).trim(),
      email: String(body.email).trim(),
      exp: Math.max(0, Number.parseInt(body.exp, 10) || 0),
      note: String(body.note || "").trim(),
      stage: "Applied"
    };
    mockState.applications.push(application);
    persistMockState();
    return copy(application);
  }
  if (resource === "applications" && id && method === "PUT") {
    if (!STAGES.includes(body.stage)) throw new Error("Unknown application stage");
    const application = mockState.applications.find(item => Number(item.id) === id);
    if (!application) throw new Error("No application with that id");
    application.stage = body.stage;
    persistMockState();
    return copy(application);
  }
  throw new Error("Unknown API route");
}

async function api(path, method, body) {
  if (backendBase) {
    try {
      return await backendRequest(path, method, body);
    } catch (error) {
      if (!(error instanceof TypeError) && error.name !== "AbortError") throw error;
      backendBase = null;
      setBackendStatus();
      toast("Java backend disconnected. Continuing with saved demo data.");
    }
  }
  return mockRequest(path, method || "GET", body || {});
}

const selectOptions = (values, selected, label) =>
  `<option value="">${esc(label)}</option>${values.map(value =>
    `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(value)}</option>`).join("")}`;
const uniqueValues = key => [...new Set(jobs.map(job => job[key]).filter(Boolean))].sort();
const skillsFor = job => Array.isArray(job.skills) ? job.skills.join(", ") : String(job.skills || "");

function updateAuthNav() {
  const element = $("authNav");
  if (!account) {
    element.innerHTML = `<button class="btn ghost" id="loginOpen">Log in</button><button class="btn" id="registerOpen">Create account</button>`;
    $("loginOpen").onclick = () => openAuth("login");
    $("registerOpen").onclick = () => openAuth("register");
    return;
  }
  element.innerHTML = `<span class="welcome">Hi, ${esc(account.name)}</span><span class="role-badge">${esc(account.role)}</span><button class="btn ghost" id="logout">Logout</button>`;
  $("logout").onclick = () => {
    account = null;
    writeStorage(STORAGE.account, null);
    toast("You are logged out.");
    render();
  };
}

function openAuth(nextMode, needsApplication) {
  authMode = nextMode;
  pendingApplication = Boolean(needsApplication);
  $("authTitle").textContent = authMode === "login" ? "Welcome back" : "Create your account";
  $("authSubmit").textContent = authMode === "login" ? "Log in" : "Create account";
  $("authNameWrap").hidden = authMode !== "register";
  $("authRoleWrap").hidden = authMode !== "register";
  $("authSwitch").textContent = authMode === "login" ? "Create an account" : "Already have an account? Log in";
  $("authError").textContent = "";
  $("authName").required = authMode === "register";
  $("authDlg").showModal();
}

function renderCandidate() {
  const version = ++renderSequence;
  $("app").innerHTML = `<div class="toolbar">
    <input id="fq" placeholder="Search title, company, skill or location" value="${esc(filters.query)}" aria-label="Search jobs">
    <select id="fc" aria-label="Filter by city">${selectOptions(uniqueValues("city"), filters.city, "All cities")}</select>
    <select id="ft" aria-label="Filter by job type">${selectOptions(uniqueValues("type"), filters.type, "All types")}</select>
  </div><p class="count" id="count"></p><div class="jobs" id="list"></div>`;
  $("fq").oninput = event => { filters.query = event.target.value; drawJobs(); };
  $("fc").onchange = event => { filters.city = event.target.value; drawJobs(); };
  $("ft").onchange = event => { filters.type = event.target.value; drawJobs(); };

  Promise.all([
    api("/jobs"),
    account ? api(`/applications?email=${encodeURIComponent(account.email)}`) : Promise.resolve([])
  ]).then(([jobList, applicationList]) => {
    if (version !== renderSequence) return;
    jobs = jobList;
    applications = applicationList;
    $("fc").innerHTML = selectOptions(uniqueValues("city"), filters.city, "All cities");
    $("ft").innerHTML = selectOptions(uniqueValues("type"), filters.type, "All types");
    drawJobs();
  }).catch(error => {
    if (version !== renderSequence) return;
    $("app").innerHTML = `<div class="empty">Could not load jobs: ${esc(error.message)}</div>`;
  });
}

function drawJobs() {
  const count = $("count");
  const list = $("list");
  if (!count || !list) return;
  const term = filters.query.trim().toLocaleLowerCase();
  const filtered = jobs.filter(job => {
    const searchable = `${job.title} ${job.company} ${job.city} ${job.type} ${skillsFor(job)}`.toLocaleLowerCase();
    return (!term || searchable.includes(term)) &&
      (!filters.city || job.city === filters.city) &&
      (!filters.type || job.type === filters.type);
  });
  count.textContent = `${filtered.length} open ${filtered.length === 1 ? "job" : "jobs"}`;
  list.innerHTML = filtered.length ? filtered.map(job => {
    const applied = applications.find(application =>
      Number(application.jobId) === Number(job.id) &&
      account && application.email.toLowerCase() === account.email.toLowerCase());
    const tags = skillsFor(job).split(",").map(skill => skill.trim()).filter(Boolean);
    return `<article class="job">
      <div><h3>${esc(job.title)}</h3><div class="meta">${esc(job.company)} · ${esc(job.city || "Remote")}</div>
      <div class="tags"><span class="tag">${esc(job.type || "Full-time")}</span>${tags.map(skill => `<span class="tag">${esc(skill)}</span>`).join("")}</div>
      ${applied ? `<div class="mine">Your application: <span class="st ${esc(applied.stage)}">${esc(applied.stage)}</span></div>` : ""}</div>
      <div><div class="pay">₹${esc(job.lpa || "Not disclosed")} LPA</div><div class="job-action">
      <button class="btn" data-apply="${esc(job.id)}"${applied ? " disabled" : ""}>${applied ? "Applied" : "Apply"}</button></div></div>
    </article>`;
  }).join("") : `<div class="empty">No jobs match these filters. Clear a filter or try another keyword or location.</div>`;
  document.querySelectorAll("[data-apply]").forEach(button => {
    button.onclick = () => {
      applyJob = Number(button.dataset.apply);
      if (!account) {
        openAuth("login", true);
        toast("Log in or create an account before applying.");
        return;
      }
      openApplyForm();
    };
  });
}

function openApplyForm() {
  const job = jobs.find(item => Number(item.id) === Number(applyJob));
  if (!job) {
    toast("That job is no longer available.");
    return;
  }
  $("dTitle").textContent = `Apply for ${job.title}`;
  $("aName").value = account ? account.name : "";
  $("aEmail").value = account ? account.email : "";
  $("aExp").value = "0";
  $("aNote").value = "";
  $("dlg").showModal();
}

async function renderRecruiter() {
  const version = ++renderSequence;
  if (!account || account.role !== "recruiter") {
    $("app").innerHTML = `<section class="panel access-panel"><h2>Recruiter dashboard</h2>
      <p>Log in with a recruiter account or create one to post vacancies and manage applications.</p>
      <div class="row"><button class="btn" id="recruiterLogin">Log in</button><button class="btn ghost" id="recruiterRegister">Create recruiter account</button></div>
      <p class="demo-hint">Demo recruiter: <strong>recruiter@jobly.in</strong> / <strong>demo123</strong></p></section>`;
    $("recruiterLogin").onclick = () => openAuth("login");
    $("recruiterRegister").onclick = () => {
      openAuth("register");
      $("authRole").value = "recruiter";
    };
    return;
  }
  try {
    const [jobList, appList] = await Promise.all([api("/jobs"), api("/applications")]);
    if (version !== renderSequence) return;
    jobs = jobList;
    applications = appList;
    drawRecruiter();
  } catch (error) {
    if (version === renderSequence) $("app").innerHTML = `<div class="empty">Could not load the recruiter dashboard: ${esc(error.message)}</div>`;
  }
}

function drawRecruiter() {
  const selectedApplications = applications.filter(application =>
    !recruiterJob || Number(application.jobId) === Number(recruiterJob));
  const hired = applications.filter(application => application.stage === "Hired").length;
  const jobTitle = id => (jobs.find(job => Number(job.id) === Number(id)) || {title: "Removed job"}).title;
  let html = `<div class="stats"><div class="stat"><b>${jobs.length}</b>Open jobs</div>
    <div class="stat"><b>${applications.length}</b>Applications</div><div class="stat"><b>${hired}</b>Hired</div></div>
    <section class="panel"><h2 class="panel-title">Post a job</h2>
    <form class="form" id="postForm">
      <label>Job title<input id="pt" maxlength="120" required></label>
      <label>Company<input id="pc" maxlength="120" required></label>
      <label>City or location<input id="pci" maxlength="100" placeholder="Remote"></label>
      <label>Type<select id="pty"><option>Full-time</option><option>Part-time</option><option>Contract</option><option>Internship</option></select></label>
      <label>Salary (LPA)<input id="pl" maxlength="40" placeholder="6-10"></label>
      <label>Skills (comma separated)<input id="ps" maxlength="250" placeholder="Java, SQL"></label>
      <div class="full"><button class="btn" type="submit">Post job</button></div>
    </form></section>
    <div class="toolbar recruiter-toolbar"><select id="rj" aria-label="Filter applications by job">
    <option value="0">All jobs</option>${jobs.map(job =>
      `<option value="${esc(job.id)}"${Number(recruiterJob) === Number(job.id) ? " selected" : ""}>${esc(job.title)} – ${esc(job.company)}</option>`).join("")}</select>
    ${recruiterJob ? `<button class="btn danger" id="rm">Remove this job</button>` : ""}</div>
    <div class="board">`;
  STAGES.slice(0, 5).forEach(stage => {
    const stageApplications = selectedApplications.filter(application => application.stage === stage);
    html += `<section class="col"><h3>${esc(stage)}<span class="tag">${stageApplications.length}</span></h3>`;
    html += stageApplications.map(application => `<article class="card ${esc(application.stage)}">
      <b>${esc(application.name)}</b><div class="meta">${esc(jobTitle(application.jobId))} · ${esc(application.exp)} yrs</div>
      <div class="meta">${esc(application.email)}</div><div class="application-note">${esc(application.note)}</div>
      <label class="stage-label">Stage<select data-mv="${esc(application.id)}" aria-label="Move ${esc(application.name)}">
      ${STAGES.map(option => `<option${option === application.stage ? " selected" : ""}>${esc(option)}</option>`).join("")}</select></label>
    </article>`).join("");
    html += `</section>`;
  });
  html += `</div>`;
  const rejected = selectedApplications.filter(application => application.stage === "Rejected");
  if (rejected.length) {
    html += `<section class="panel rejected-panel"><h3>Rejected (${rejected.length})</h3>
      <div class="rejected-list">${rejected.map(application => `<article class="rejected-card">
      <span>${esc(application.name)} · ${esc(jobTitle(application.jobId))}</span>
      <label class="stage-label">Stage<select data-mv="${esc(application.id)}" aria-label="Move ${esc(application.name)}">
      ${STAGES.map(option => `<option${option === application.stage ? " selected" : ""}>${esc(option)}</option>`).join("")}</select></label>
      </article>`).join("")}</div></section>`;
  }
  if (!selectedApplications.length) html += `<div class="empty dashboard-empty">No applications yet. Candidates' applications will appear here.</div>`;
  $("app").innerHTML = html;
  $("rj").onchange = event => { recruiterJob = Number(event.target.value); renderRecruiter(); };
  $("postForm").onsubmit = async event => {
    event.preventDefault();
    const submit = $("postForm").querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      await api("/jobs", "POST", {
        title: $("pt").value,
        company: $("pc").value,
        city: $("pci").value,
        type: $("pty").value,
        lpa: $("pl").value,
        skills: $("ps").value
      });
      toast("Job posted. It is now visible in Find jobs.");
      recruiterJob = 0;
      await renderRecruiter();
    } catch (error) {
      toast(error.message);
      submit.disabled = false;
    }
  };
  if ($("rm")) $("rm").onclick = async () => {
    if (!confirm("Remove this job and all its applications?")) return;
    try {
      await api(`/jobs/${recruiterJob}`, "DELETE");
      recruiterJob = 0;
      toast("Job removed.");
      renderRecruiter();
    } catch (error) {
      toast(error.message);
    }
  };
  document.querySelectorAll("[data-mv]").forEach(select => {
    select.onchange = async () => {
      try {
        const updated = await api(`/applications/${select.dataset.mv}`, "PUT", {stage: select.value});
        toast(`${updated.name} moved to ${updated.stage}.`);
        renderRecruiter();
      } catch (error) {
        toast(error.message);
      }
    };
  });
}

function render() {
  $("t-cand").setAttribute("aria-selected", String(mode === "cand"));
  $("t-rec").setAttribute("aria-selected", String(mode === "rec"));
  updateAuthNav();
  if (mode === "cand") renderCandidate();
  else renderRecruiter();
}

$("t-cand").onclick = () => { mode = "cand"; render(); };
$("t-rec").onclick = () => { mode = "rec"; render(); };
$("authSwitch").onclick = () => openAuth(authMode === "login" ? "register" : "login", pendingApplication);
$("authCancel").onclick = () => $("authDlg").close();
$("aCancel").onclick = () => $("dlg").close();

$("authForm").onsubmit = event => {
  event.preventDefault();
  const email = $("authEmail").value.trim().toLowerCase();
  const password = $("authPassword").value;
  const name = $("authName").value.trim();
  if (authMode === "register") {
    if (!name) {
      $("authError").textContent = "Enter your name.";
      return;
    }
    if (accounts.some(item => item.email.toLowerCase() === email)) {
      $("authError").textContent = "An account with this email already exists. Log in instead.";
      return;
    }
    const registered = {name, email, password, role: $("authRole").value};
    accounts.push(registered);
    account = {name, email, role: registered.role};
    writeStorage(STORAGE.accounts, accounts);
  } else {
    const found = accounts.find(item => item.email.toLowerCase() === email && item.password === password);
    if (!found) {
      $("authError").textContent = "Email or password is incorrect. Try one of the demo accounts below.";
      return;
    }
    account = {name: found.name, email: found.email, role: found.role};
  }
  writeStorage(STORAGE.account, account);
  $("authDlg").close();
  toast(`Signed in as ${account.name}.`);
  const continueToApplication = pendingApplication;
  pendingApplication = false;
  if (mode === "rec" && account.role !== "recruiter") mode = "cand";
  render();
  if (continueToApplication && account.role === "candidate") setTimeout(openApplyForm, 0);
};

$("applyForm").onsubmit = async event => {
  event.preventDefault();
  if (!account) {
    $("dlg").close();
    openAuth("login", true);
    return;
  }
  try {
    await api("/applications", "POST", {
      jobId: applyJob,
      name: $("aName").value.trim(),
      email: $("aEmail").value.trim(),
      exp: $("aExp").value,
      note: $("aNote").value.trim()
    });
    $("dlg").close();
    toast("Application sent.");
    render();
  } catch (error) {
    toast(error.message);
  }
};

async function start() {
  await detectBackend();
  render();
  window.setInterval(async () => {
    if (backendBase || document.visibilityState === "hidden") return;
    await detectBackend();
    if (backendBase) {
      toast("Java backend connected. Live data is now active.");
      render();
    }
  }, 15000);
}
start();
