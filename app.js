const API_BASE = window.location.protocol === "file:" 
  ? "http://localhost:3008" 
  : window.location.origin;

// Application State
let workLogs = []; // Stores all records fetched from server
let activeDate = ""; // Selected date on the active sheet
let serverStatus = { status: "offline", sharingUrl: "" };
let operatorPermissions = {}; // Maps operator name to boolean (true = allowed to edit)

// Initialize Page Data and Listeners
document.addEventListener("DOMContentLoaded", () => {
  // Set default sheet date to current local date
  const today = new Date().toISOString().split("T")[0];
  const dateInput = document.getElementById("selected-sheet-date");
  dateInput.value = today;
  activeDate = today;

  // Initial loads
  fetchStatus();
  fetchPermissions().then(() => {
    switchUserRole();
    fetchRecords();
  });

  // Poll status occasionally to verify backend server health (every 10 seconds)
  setInterval(fetchStatus, 10000);
});

// Fetch Connection Status from server
async function fetchStatus() {
  const statusBadge = document.getElementById("connection-status");
  const statusDot = statusBadge.querySelector(".status-dot");
  const statusText = statusBadge.querySelector("span");

  try {
    const res = await fetch(`${API_BASE}/api/status`);
    if (!res.ok) throw new Error("Server error");
    
    serverStatus = await res.json();
    
    statusBadge.title = `Host URL: ${serverStatus.sharingUrl}`;
    statusText.innerHTML = `Central DB Active | Share: <a href="${serverStatus.sharingUrl}" target="_blank" style="color: #a5b4fc; text-decoration: underline;">${serverStatus.sharingUrl}</a>`;
    statusDot.style.backgroundColor = "var(--success)";
    statusDot.style.boxShadow = "0 0 8px var(--success)";
  } catch (err) {
    console.warn("Could not connect to Lonrix database server:", err);
    statusText.textContent = "Server Offline (Editing in Local Memory)";
    statusDot.style.backgroundColor = "var(--danger)";
    statusDot.style.boxShadow = "0 0 8px var(--danger)";
  }
}

// Fetch Operator Editing Permissions from Server
async function fetchPermissions() {
  try {
    const res = await fetch(`${API_BASE}/api/permissions`);
    if (res.ok) {
      operatorPermissions = await res.json();
    }
  } catch (err) {
    console.warn("Could not fetch operator permissions from server:", err);
    // Initialize locally if server is offline
    if (Object.keys(operatorPermissions).length === 0) {
      for (let i = 1; i <= 10; i++) operatorPermissions[`OP ${i}`] = true;
    }
  }
}

// User role selection switcher
function switchUserRole() {
  const roleSelect = document.getElementById("active-user-role");
  const role = roleSelect ? roleSelect.value : "User";

  const btnExport = document.getElementById("btn-export-csv");
  const btnReset = document.getElementById("btn-reset-data");
  const adminPanel = document.getElementById("admin-permissions-panel");

  if (role === "Admin") {
    // Show Admin Only items
    if (btnExport) btnExport.style.display = "inline-flex";
    if (btnReset) btnReset.style.display = "inline-flex";
    if (adminPanel) adminPanel.style.display = "block";
    renderPermissionsList();
  } else {
    // Hide Admin Only items
    if (btnExport) btnExport.style.display = "none";
    if (btnReset) btnReset.style.display = "none";
    if (adminPanel) adminPanel.style.display = "none";
  }

  // Refresh grid spreadsheet to lock/unlock cells
  renderSpreadsheet();
}

// Render dynamic checklists for Admins to control Operator edits
function renderPermissionsList() {
  const list = document.getElementById("permissions-toggle-list");
  if (!list) return;
  list.innerHTML = "";

  for (let i = 1; i <= 10; i++) {
    const opName = `OP ${i}`;
    const isAllowed = operatorPermissions[opName] !== false;
    const div = document.createElement("div");
    
    // Style toggle element
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.gap = "0.5rem";
    div.style.backgroundColor = "rgba(30, 41, 59, 0.4)";
    div.style.padding = "0.35rem 0.75rem";
    div.style.borderRadius = "var(--button-radius)";
    div.style.border = "1px solid var(--border-color)";

    div.innerHTML = `
      <input type="checkbox" id="perm-chk-${opName.replace(" ", "")}" 
             ${isAllowed ? "checked" : ""} onchange="toggleOperatorPermission('${opName}', this.checked)"
             style="width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer;">
      <label for="perm-chk-${opName.replace(" ", "")}" style="font-size: 0.8rem; cursor: pointer; user-select: none; color: var(--text-secondary);">
        ${opName} Edits
      </label>
    `;
    list.appendChild(div);
  }
}

// Toggle permissions API call
async function toggleOperatorPermission(opName, isChecked) {
  operatorPermissions[opName] = isChecked;
  try {
    const res = await fetch(`${API_BASE}/api/permissions?role=Admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-role': 'Admin'
      },
      body: JSON.stringify({ [opName]: isChecked })
    });
    if (res.ok) {
      showToast(`Permissions updated: ${opName} edits ${isChecked ? 'enabled' : 'disabled'}.`, "success");
    } else {
      showToast(`Database server rejected permissions update.`, "error");
    }
  } catch (err) {
    showToast(`Could not save permission update to server database.`, "error");
    console.error(err);
  }
  renderSpreadsheet();
}

// Fetch All Records from Server and Render Grid
async function fetchRecords() {
  try {
    const res = await fetch(`${API_BASE}/api/records`);
    if (!res.ok) throw new Error("Could not load records");
    
    workLogs = await res.json();
    renderSpreadsheet();
    calculateDashboardMetrics();
  } catch (err) {
    showToast("Failed to connect to server database. Offline mode active.", "error");
    console.error(err);
    // Render blank grid in case of network issues
    renderSpreadsheet();
  }
}

// Render the 10 Operators Excel Grid for the Active Date
function renderSpreadsheet() {
  const tableBody = document.getElementById("table-body");
  tableBody.innerHTML = "";

  const dateVal = activeDate;
  const dayVal = getDayName(dateVal);

  // Generate 10 rows for OP 1 - OP 10
  for (let i = 1; i <= 10; i++) {
    const opName = `OP ${i}`;
    
    // Find if a record exists for this operator and date
    let log = workLogs.find(r => r.operator === opName && r.date === dateVal);
    
    // If no record exists, create a default template object (but do not POST to server yet)
    if (!log) {
      log = {
        id: "", // Blank ID indicates a new unsaved record
        operator: opName,
        date: dateVal,
        day: dayVal,
        startTime: "",
        endTime: "",
        stretch: "",
        attendance: "Working",
        generalIssues: "",
        vehicleNumber: "",
        aeMet: "No",
        ieMet: "No",
        videoUploaded: "No",
        syncProcessCompleted: "No",
        otherVideoProblems: "" // Serves as the issue details
      };
    }

    const row = document.createElement("tr");
    row.id = `row-${opName.replace(" ", "-")}`;
    if (log.attendance !== "Working") {
      row.className = `row-${log.attendance.toLowerCase()}`;
    }

    row.innerHTML = `
      <!-- Operator Number -->
      <td>
        <div class="cell-static" style="font-weight: 600; color: #a5b4fc;">${opName}</div>
      </td>
      
      <!-- Date (Read-only) -->
      <td>
        <div class="cell-static">${formatDate(dateVal)}</div>
      </td>
      
      <!-- Day (Read-only) -->
      <td>
        <div class="cell-static">${dayVal}</div>
      </td>
      
      <!-- Starting Time -->
      <td>
        <input type="time" class="cell-input" value="${log.startTime || ''}" 
               onblur="autoSaveRow('${opName}')" id="time-start-${opName}">
      </td>
      
      <!-- Ending Time -->
      <td>
        <input type="time" class="cell-input" value="${log.endTime || ''}" 
               onblur="autoSaveRow('${opName}')" id="time-end-${opName}">
      </td>
      
      <!-- Stretch Covered -->
      <td>
        <input type="text" class="cell-input" placeholder="e.g. KM 10-15" value="${log.stretch || ''}" 
               onblur="autoSaveRow('${opName}')" id="stretch-${opName}">
      </td>
      
      <!-- Attendance Status -->
      <td>
        <select class="cell-input editable-always" onchange="handleAttendanceChange('${opName}')" id="attendance-${opName}">
          <option value="Working" ${log.attendance === 'Working' ? 'selected' : ''} class="badge-cell-present">Working</option>
          <option value="Absent" ${log.attendance === 'Absent' ? 'selected' : ''} class="badge-cell-absent">Absent</option>
          <option value="Holiday" ${log.attendance === 'Holiday' ? 'selected' : ''} class="badge-cell-holiday">Holiday</option>
        </select>
      </td>
      
      <!-- Issues -->
      <td>
        <input type="text" class="cell-input editable-always" placeholder="Operation issues..." value="${log.generalIssues || ''}" 
               onblur="autoSaveRow('${opName}')" id="issues-${opName}">
      </td>
      
      <!-- Vehicle Number -->
      <td>
        <input type="text" class="cell-input" placeholder="e.g. DL-3C-1234" value="${log.vehicleNumber || ''}" 
               onblur="autoSaveRow('${opName}')" id="vehicle-${opName}">
      </td>
      
      <!-- AE Meeting Status -->
      <td>
        <select class="cell-input" onchange="autoSaveRow('${opName}')" id="ae-status-${opName}">
          <option value="No" ${log.aeMet === 'No' ? 'selected' : ''}>No</option>
          <option value="Yes" ${log.aeMet === 'Yes' ? 'selected' : ''}>Yes</option>
        </select>
      </td>
      
      <!-- IE Meeting Status -->
      <td>
        <select class="cell-input" onchange="autoSaveRow('${opName}')" id="ie-status-${opName}">
          <option value="No" ${log.ieMet === 'No' ? 'selected' : ''}>No</option>
          <option value="Yes" ${log.ieMet === 'Yes' ? 'selected' : ''}>Yes</option>
        </select>
      </td>
      
      <!-- Test Video Uploaded -->
      <td>
        <select class="cell-input" onchange="handleVideoChange('${opName}')" id="video-uploaded-${opName}">
          <option value="No" ${log.videoUploaded === 'No' ? 'selected' : ''}>No</option>
          <option value="Yes" ${log.videoUploaded === 'Yes' ? 'selected' : ''}>Yes</option>
        </select>
      </td>

      <!-- Syncing Process Completed -->
      <td>
        <select class="cell-input" onchange="autoSaveRow('${opName}')" id="sync-completed-${opName}">
          <option value="No" ${log.syncProcessCompleted === 'No' ? 'selected' : ''}>No</option>
          <option value="Yes" ${log.syncProcessCompleted === 'Yes' ? 'selected' : ''}>Yes</option>
        </select>
      </td>
      
      <!-- Test Video Issue Details -->
      <td>
        <input type="text" class="cell-input" placeholder="GPS, Quality, Upload fail..." value="${log.otherVideoProblems || ''}" 
               onblur="autoSaveRow('${opName}')" id="video-issues-${opName}">
      </td>
      
      <!-- Sync Status Badge -->
      <td>
        <div class="sync-badge ${log.id ? 'synced' : ''}" id="sync-status-${opName.replace(' ', '')}"></div>
      </td>
    `;

    tableBody.appendChild(row);
    
    // Apply conditional disabling based on loaded attendance status
    applyRowFormatting(opName, log.attendance, log.videoUploaded || log.videoCompleted);
  }
}

// Handle Attendance Selector Changes (Working / Absent / Holiday)
function handleAttendanceChange(opName) {
  const attendance = document.getElementById(`attendance-${opName}`).value;
  const videoUploaded = document.getElementById(`video-uploaded-${opName}`).value;
  
  applyRowFormatting(opName, attendance, videoUploaded);
  autoSaveRow(opName);
}

// Handle Video Selector Changes
function handleVideoChange(opName) {
  const attendance = document.getElementById(`attendance-${opName}`).value;
  const videoUploaded = document.getElementById(`video-uploaded-${opName}`).value;

  applyRowFormatting(opName, attendance, videoUploaded);
  autoSaveRow(opName);
}

// Formatting cell rules based on Attendance and Video states
function applyRowFormatting(opName, attendance, videoUploaded) {
  const rowId = `row-${opName.replace(" ", "-")}`;
  const row = document.getElementById(rowId);
  if (!row) return;

  // 1. Reset row class
  row.className = "";

  // 2. Check role-based edit permissions
  const roleSelect = document.getElementById("active-user-role");
  const role = roleSelect ? roleSelect.value : "User";
  const isEditPermitted = (role === "Admin") || (operatorPermissions[opName] !== false);

  if (!isEditPermitted) {
    row.classList.add("row-absent"); // Dim the row
    const allInputs = row.querySelectorAll(".cell-input");
    allInputs.forEach(input => {
      input.style.opacity = "0.3";
      input.style.pointerEvents = "none";
      input.style.cursor = "not-allowed";
    });
    return; // Block status checks as the whole row is disabled
  }

  if (attendance === "Working") {
    // Enable all inputs
    const inputs = row.querySelectorAll(".cell-input");
    inputs.forEach(input => {
      input.style.opacity = "1";
      input.style.pointerEvents = "auto";
      input.style.cursor = "text";
    });

    // Disable video issues field if video was uploaded successfully
    const videoIssuesInput = document.getElementById(`video-issues-${opName}`);
    if (videoUploaded === "Yes") {
      videoIssuesInput.value = ""; // Clear text
      videoIssuesInput.style.opacity = "0.3";
      videoIssuesInput.style.pointerEvents = "none";
      videoIssuesInput.style.cursor = "not-allowed";
      videoIssuesInput.placeholder = "No Issues";
    } else {
      videoIssuesInput.placeholder = "Details of problems...";
    }

  } else {
    // Absent or Holiday: Gray out row
    row.className = `row-${attendance.toLowerCase()}`;
    
    // Disable inputs that depend on being Working
    const inputs = row.querySelectorAll(".cell-input:not(.editable-always)");
    inputs.forEach(input => {
      // Clear values for accuracy
      if (input.tagName === "INPUT") {
        input.value = "";
      } else if (input.tagName === "SELECT") {
        input.value = "No";
      }
      input.style.opacity = "0.3";
      input.style.pointerEvents = "none";
      input.style.cursor = "not-allowed";
    });
  }
}

// Triggered when a date is selected at the top
function loadDateSheet() {
  const dateInput = document.getElementById("selected-sheet-date");
  if (dateInput.value) {
    activeDate = dateInput.value;
    renderSpreadsheet();
    calculateDashboardMetrics();
  }
}

// Auto Save Action on focus loss (blur) or option selection change
async function autoSaveRow(opName) {
  const syncBadge = document.getElementById(`sync-status-${opName.replace(' ', '')}`);
  
  // Visual Feedback - Saving State
  syncBadge.className = "sync-badge saving";

  // Gather values from cells
  const attendance = document.getElementById(`attendance-${opName}`).value;
  const startTime = document.getElementById(`time-start-${opName}`).value;
  const endTime = document.getElementById(`time-end-${opName}`).value;
  const stretch = document.getElementById(`stretch-${opName}`).value;
  const generalIssues = document.getElementById(`issues-${opName}`).value;
  const vehicleNumber = document.getElementById(`vehicle-${opName}`).value;
  const aeMet = document.getElementById(`ae-status-${opName}`).value;
  const ieMet = document.getElementById(`ie-status-${opName}`).value;
  const videoUploaded = document.getElementById(`video-uploaded-${opName}`).value;
  const syncProcessCompleted = document.getElementById(`sync-completed-${opName}`).value;
  const otherVideoProblems = document.getElementById(`video-issues-${opName}`).value;

  const dateVal = activeDate;
  const dayVal = getDayName(dateVal);

  // Time Validation
  if (attendance === "Working" && startTime && endTime && startTime > endTime) {
    showToast(`${opName}: Starting Time must be before Ending Time.`, "error");
    syncBadge.className = "sync-badge error";
    return;
  }

  // Find local copy to retrieve ID if it exists
  const existingRecord = workLogs.find(r => r.operator === opName && r.date === dateVal);
  const id = existingRecord ? existingRecord.id : "";

  const payload = {
    operator: opName,
    date: dateVal,
    day: dayVal,
    startTime: attendance === "Working" ? startTime : "",
    endTime: attendance === "Working" ? endTime : "",
    stretch: attendance === "Working" ? stretch : "None",
    attendance: attendance,
    generalIssues: generalIssues || "None",
    vehicleNumber: attendance === "Working" ? vehicleNumber : "",
    aeMet: attendance === "Working" ? aeMet : "No",
    ieMet: attendance === "Working" ? ieMet : "No",
    videoUploaded: attendance === "Working" ? videoUploaded : "No",
    syncProcessCompleted: attendance === "Working" ? syncProcessCompleted : "No",
    otherVideoProblems: (attendance === "Working" && videoUploaded === "No") ? otherVideoProblems : ""
  };

  try {
    let url = `${API_BASE}/api/records`;
    let method = "POST";

    if (id) {
      url = `${API_BASE}/api/records/${id}`;
      method = "PUT";
    }

    const res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error("Failed to write to database");

    const savedLog = await res.json();

    // Update in-memory state
    if (id) {
      const idx = workLogs.findIndex(r => r.id === id);
      if (idx !== -1) workLogs[idx] = savedLog;
    } else {
      workLogs.push(savedLog);
    }

    // Success styling
    syncBadge.className = "sync-badge synced";
    calculateDashboardMetrics();
  } catch (err) {
    console.error("Autosave failed:", err);
    syncBadge.className = "sync-badge error";
    showToast(`Autosave failed for ${opName}. Check connection.`, "error");
  }
}

// Compute & Display Dashboard KPI Metrics based on the active sheet's date
function calculateDashboardMetrics() {
  const dateVal = activeDate;
  
  // Filter logs representing only the selected date for sheet calculations
  const activeSheetLogs = workLogs.filter(log => log.date === dateVal);
  const totalSheetRows = activeSheetLogs.length;

  // 1. Total operators profile count (always 10 for display)
  document.getElementById("val-active-ops").textContent = 10;

  // 2. Sum up stretch length dynamically (all-time history stretch)
  let totalStretch = 0;
  workLogs.forEach(log => {
    if (log.attendance === "Working" && log.stretch) {
      totalStretch += calculateStretchLength(log.stretch);
    }
  });
  document.getElementById("val-total-stretch").textContent = `${totalStretch.toFixed(1)} km`;

  // 3. Attendance Rate (for the active sheet)
  const workingCount = activeSheetLogs.filter(log => log.attendance === "Working").length;
  const attendanceRate = totalSheetRows > 0 ? (workingCount / totalSheetRows) * 100 : 0;
  document.getElementById("val-attendance-rate").textContent = `${Math.round(attendanceRate)}%`;

  // 4. PIU Representative Meetings (Any active sheet log with AE=Yes or IE=Yes)
  const piuMeets = activeSheetLogs.filter(log => log.attendance === "Working" && (log.aeMet === "Yes" || log.ieMet === "Yes")).length;
  document.getElementById("val-piu-meetings").textContent = piuMeets;

  // 5. Video Completion Rate (Working operators on active sheet)
  const workingLogs = activeSheetLogs.filter(log => log.attendance === "Working");
  const videoUploadedCount = workingLogs.filter(log => log.videoUploaded === "Yes" || log.videoCompleted === "Yes").length;
  const videoRate = workingLogs.length > 0 ? (videoUploadedCount / workingLogs.length) * 100 : 0;
  document.getElementById("val-video-rate").textContent = `${Math.round(videoRate)}%`;
}

// Helper: Parse numerical distance from text input (e.g. "KM 10 - KM 15" -> 5)
function calculateStretchLength(stretchText) {
  if (!stretchText || stretchText.toLowerCase() === "none") return 0;
  
  // Format range: "KM 10 - KM 15" or "10 to 15" or "10-15"
  const rangeMatch = stretchText.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/i);
  if (rangeMatch) {
    const start = parseFloat(rangeMatch[1]);
    const end = parseFloat(rangeMatch[2]);
    return Math.abs(end - start);
  }
  
  // Single number format: "5.5 km" or "6"
  const singleMatch = stretchText.match(/(\d+(?:\.\d+)?)/);
  if (singleMatch) {
    return parseFloat(singleMatch[0]);
  }
  return 0;
}

// Compute Day of Week String from date (YYYY-MM-DD)
function getDayName(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const offset = date.getTimezoneOffset();
  const adjustedDate = new Date(date.getTime() + (offset * 60 * 1000));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[adjustedDate.getDay()];
}

// Wipes database clean on Server
async function resetDatabaseConfirm() {
  if (confirm("Warning: This will permanently wipe all logs from the centralized server database. Do you wish to continue?")) {
    try {
      const res = await fetch(`${API_BASE}/api/reset`, {
        method: "POST",
        headers: {
          "x-role": "Admin"
        }
      });

      if (!res.ok) throw new Error("Failed to clear database");

      workLogs = [];
      renderSpreadsheet();
      calculateDashboardMetrics();
      showToast("Central database cleared.", "warning");
    } catch (err) {
      showToast("Failed to clean database.", "error");
      console.error(err);
    }
  }
}

// Toast notification helper
function showToast(message, type = "success") {
  const container = document.getElementById("toast-manager");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let icon = "🔔";
  if (type === "success") icon = "✅";
  else if (type === "error") icon = "❌";
  else if (type === "warning") icon = "⚠️";
  else if (type === "info") icon = "ℹ️";

  toast.innerHTML = `
    <span>${icon}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  
  setTimeout(() => toast.classList.add("show"), 50);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Format date nicely (YYYY-MM-DD -> DD MMM YYYY)
function formatDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  const offset = date.getTimezoneOffset();
  const adjustedDate = new Date(date.getTime() + (offset * 60 * 1000));
  
  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  return adjustedDate.toLocaleDateString('en-US', options);
}

// Export the active sheet (10 operators) to CSV
function exportToCSV() {
  const dateVal = activeDate;
  const activeSheetLogs = [];

  // Re-build row logs matching current UI state for accurate download
  for (let i = 1; i <= 10; i++) {
    const opName = `OP ${i}`;
    const attendance = document.getElementById(`attendance-${opName}`).value;
    const startTime = document.getElementById(`time-start-${opName}`).value;
    const endTime = document.getElementById(`time-end-${opName}`).value;
    const stretch = document.getElementById(`stretch-${opName}`).value;
    const generalIssues = document.getElementById(`issues-${opName}`).value;
    const vehicleNumber = document.getElementById(`vehicle-${opName}`).value;
    const aeMet = document.getElementById(`ae-status-${opName}`).value;
    const ieMet = document.getElementById(`ie-status-${opName}`).value;
    const videoUploaded = document.getElementById(`video-uploaded-${opName}`).value;
    const syncProcessCompleted = document.getElementById(`sync-completed-${opName}`).value;
    const otherVideoProblems = document.getElementById(`video-issues-${opName}`).value;

    activeSheetLogs.push({
      operator: opName,
      date: dateVal,
      day: getDayName(dateVal),
      startTime: attendance === "Working" ? startTime : "",
      endTime: attendance === "Working" ? endTime : "",
      stretch: attendance === "Working" ? stretch : "None",
      attendance,
      generalIssues: generalIssues || "None",
      vehicleNumber: attendance === "Working" ? vehicleNumber : "",
      aeMet: attendance === "Working" ? aeMet : "No",
      ieMet: attendance === "Working" ? ieMet : "No",
      videoUploaded: attendance === "Working" ? videoUploaded : "No",
      syncProcessCompleted: attendance === "Working" ? syncProcessCompleted : "No",
      otherVideoProblems: (attendance === "Working" && videoUploaded === "No") ? otherVideoProblems : ""
    });
  }

  // Headers matching requested names exactly
  const headers = [
    "Operator Number",
    "Date",
    "Day",
    "Starting Time",
    "Ending Time",
    "Stretch Covered",
    "Attendance Status",
    "Issues",
    "Vehicle Number",
    "AE Meeting Status",
    "IE Meeting Status",
    "Test Video Uploaded",
    "Syncing Process Completed",
    "Test Video Issue Details"
  ];

  const rows = activeSheetLogs.map(log => [
    log.operator,
    log.date,
    log.day,
    log.startTime || "",
    log.endTime || "",
    log.stretch || "None",
    log.attendance,
    log.generalIssues || "None",
    log.vehicleNumber || "",
    log.aeMet,
    log.ieMet,
    log.videoUploaded,
    log.syncProcessCompleted,
    log.otherVideoProblems || ""
  ]);

  let csvContent = "data:text/csv;charset=utf-8," 
    + [headers.join(","), ...rows.map(row => row.map(cell => `"${(cell || "").toString().replace(/"/g, '""')}"`).join(","))].join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Lonrix_Sheet_${dateVal}.csv`);
  document.body.appendChild(link);

  link.click();
  document.body.removeChild(link);
  showToast("Spreadsheet page exported successfully.", "success");
}

// Simple HTML escaping helper for security
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>"']/g, function(match) {
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return escapeMap[match];
  });
}
