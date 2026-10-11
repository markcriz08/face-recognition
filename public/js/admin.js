document.addEventListener('DOMContentLoaded', () => {
    checkAdminAuth();

    // Login Form Handler
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        try {
            const res = await axios.post('/api/admin/login', { email, password });
            if (res.data.success) {
                localStorage.setItem('admin_session', JSON.stringify(res.data.admin));
                checkAdminAuth();
            }
        } catch (err) {
            alert(err.response?.data?.error || 'Login failed.');
        }
    });

    // Register Form Handler
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pass = document.getElementById('reg-pass').value;
        const confirmPass = document.getElementById('reg-confirm-pass').value;
        if (pass !== confirmPass) return alert('Passwords do not match.');

        const payload = {
            name: document.getElementById('reg-name').value,
            age: document.getElementById('reg-age').value,
            contact: document.getElementById('reg-contact').value,
            address: document.getElementById('reg-address').value,
            email: document.getElementById('reg-email').value,
            password: pass
        };

        try {
            const res = await axios.post('/api/admin/register', payload);
            if (res.data.success) {
                window.pendingVerificationEmail = payload.email;
                alert('Registration successful! Check your server console for the 6-digit verification PIN.');
                toggleAuthView('verify');
            }
        } catch (err) {
            alert(err.response?.data?.error || 'Registration failed.');
        }
    });

    // Verification Form Handler
    document.getElementById('verify-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('verify-code').value;
        const email = window.pendingVerificationEmail;

        try {
            const res = await axios.post('/api/admin/verify', { email, code });
            if (res.data.success) {
                alert('Account verified successfully! You can now log in.');
                toggleAuthView('login');
            }
        } catch (err) {
            alert(err.response?.data?.error || 'Verification failed.');
        }
    });

    // Logout Handler
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('admin_session');
            checkAdminAuth();
        });
    }

    // ==================== WEBCAM & STAFF REGISTRATION ====================
    const staffModalEl = document.getElementById('staffModal');
    let regDetectionInterval = null;

    if (staffModalEl) {
        staffModalEl.addEventListener('shown.bs.modal', async () => {
            const regStatus = document.getElementById('reg-face-status');
            try {
                if (regStatus) regStatus.innerText = 'Starting webcam...';
                const video = document.getElementById('reg-webcam');
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                video.srcObject = stream;

                if (regStatus) regStatus.innerText = 'Loading AI Recognition models...';
                const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
                await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
                await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
                await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

                if (regStatus) regStatus.innerText = 'Position your face in front of the camera...';

                // Continuous face detection feedback loop
                regDetectionInterval = setInterval(async () => {
                    if (!video || video.paused || video.ended) return;
                    try {
                        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
                            .withFaceLandmarks()
                            .withFaceDescriptor();

                        if (detection) {
                            if (regStatus) regStatus.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill"></i> Face detected! Ready to register.</span>';
                        } else {
                            if (regStatus) regStatus.innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle-fill"></i> Scanning for face... Look directly at camera</span>';
                        }
                    } catch (e) {
                        // ignore interval frame noise
                    }
                }, 1000);

            } catch (err) {
                console.error('Webcam/Model access error:', err);
                if (regStatus) regStatus.innerText = `Error: ${err.message}`;
            }
        });

        staffModalEl.addEventListener('hidden.bs.modal', () => {
            if (regDetectionInterval) clearInterval(regDetectionInterval);
            const video = document.getElementById('reg-webcam');
            if (video && video.srcObject) {
                video.srcObject.getTracks().forEach(track => track.stop());
            }
        });
    }
});

// Check if admin is logged in
function checkAdminAuth() {
    const session = localStorage.getItem('admin_session');
    const authScreen = document.getElementById('auth-screen');
    const adminDashboard = document.getElementById('admin-dashboard');

    if (session) {
        authScreen.classList.add('d-none');
        adminDashboard.classList.remove('d-none');
        loadStaffMembers();
    } else {
        authScreen.classList.remove('d-none');
        adminDashboard.classList.add('d-none');
    }
}

// Toggle between Login, Register, and Verify views
function toggleAuthView(view) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const verifyForm = document.getElementById('verify-form');

    loginForm.classList.add('d-none');
    registerForm.classList.add('d-none');
    verifyForm.classList.add('d-none');

    if (view === 'login') loginForm.classList.remove('d-none');
    if (view === 'register') registerForm.classList.remove('d-none');
    if (view === 'verify') verifyForm.classList.remove('d-none');
}

// Tab Switching
function switchTab(tabName) {
    document.querySelectorAll('.content-section').forEach(el => el.classList.add('d-none'));
    document.querySelectorAll('.sidebar .nav-link').forEach(el => {
        el.classList.remove('active', 'text-white');
        el.classList.add('text-white-50');
    });
    
    if (tabName === 'staff') {
        document.getElementById('tab-staff').classList.remove('d-none');
        document.querySelectorAll('.sidebar .nav-link')[0].classList.add('active', 'text-white');
        document.querySelectorAll('.sidebar .nav-link')[0].classList.remove('text-white-50');
        loadStaffMembers();
    } else if (tabName === 'records') {
        document.getElementById('tab-records').classList.remove('d-none');
        document.querySelectorAll('.sidebar .nav-link')[1].classList.add('active', 'text-white');
        document.querySelectorAll('.sidebar .nav-link')[1].classList.remove('text-white-50');
        loadTimeRecords();
    } else if (tabName === 'admins') {
        document.getElementById('tab-admins').classList.remove('d-none');
        document.querySelectorAll('.sidebar .nav-link')[2].classList.add('active', 'text-white');
        document.querySelectorAll('.sidebar .nav-link')[2].classList.remove('text-white-50');
        loadAdminUsers();
    }
}

// Load Staff Members
async function loadStaffMembers() {
    try {
        const res = await axios.get('/api/staff');
        const tbody = document.getElementById('staff-table-body');
        tbody.innerHTML = res.data.map(s => `
            <tr>
                <td><img src="${s.display_photo || 'https://via.placeholder.com/40'}" width="40" height="40" class="rounded-circle shadow-sm object-fit-cover"></td>
                <td class="fw-bold font-monospace text-primary">${s.delta_code}</td>
                <td class="fw-semibold">${s.name}</td>
                <td>${s.contact}</td>
                <td class="text-muted small">${s.address}</td>
                <td>${s.age} <span class="text-muted small">(${s.birthday})</span></td>
                <td>${s.date_hired}</td>
                <td><a href="${s.facebook_link}" target="_blank" class="btn btn-sm btn-outline-primary py-0 px-2"><i class="bi bi-facebook"></i> Profile</a></td>
                <td><button class="btn btn-danger btn-sm shadow-sm px-2 py-1" onclick="deleteStaff('${s.id}')"><i class="bi bi-trash-fill"></i></button></td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load staff:', err);
    }
}

// Capture Face & Register Staff Member
async function captureStaffFace() {
    const video = document.getElementById('reg-webcam');
    const regStatus = document.getElementById('reg-face-status');

    if (!video.srcObject) {
        alert('Webcam is not active.');
        return;
    }

    if (regStatus) regStatus.innerText = 'Extracting facial biometrics...';

    try {
        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detection) {
            alert('❌ No face detected! Please position your face clearly in front of the camera.');
            if (regStatus) regStatus.innerText = 'No face detected. Position yourself in front of camera.';
            return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const photoBase64 = canvas.toDataURL('image/jpeg');

        const payload = {
            delta_code: document.getElementById('staff-delta').value,
            name: document.getElementById('staff-name').value,
            contact: document.getElementById('staff-contact').value,
            messenger_psid: document.getElementById('staff-psid') ? document.getElementById('staff-psid').value.trim() : '',
            address: document.getElementById('staff-address').value,
            age: document.getElementById('staff-age').value,
            birthday: document.getElementById('staff-bday').value,
            date_hired: document.getElementById('staff-hired').value,
            facebook_link: document.getElementById('staff-fb').value,
            display_photo: photoBase64,
            face_descriptor: Array.from(detection.descriptor)
        };

        if (!payload.delta_code || !payload.name) {
            alert('Please fill in the Delta Code and Full Name fields.');
            return;
        }

        const res = await axios.post('/api/staff', payload);
        if (res.data.success) {
            alert('✅ Staff member registered successfully with facial biometrics!');
            const staffModalEl = document.getElementById('staffModal');
            const modal = bootstrap.Modal.getInstance(staffModalEl);
            if (modal) modal.hide();
            loadStaffMembers();
        }
    } catch (err) {
        console.error('Registration Error:', err);
        alert(err.response?.data?.error || `Registration failed: ${err.message}`);
    }
}

// Load Time Records with Edit/Save & Delete
async function loadTimeRecords() {
    try {
        const res = await axios.get('/api/records');
        const tbody = document.getElementById('records-table-body');
        tbody.innerHTML = res.data.map(r => `
            <tr id="record-row-${r.id}">
                <td class="fw-bold font-monospace text-primary">${r.delta_code}</td>
                <td class="fw-semibold">${r.name}</td>
                <td class="text-muted small">${r.record_date}</td>
                <td><input type="text" class="form-control form-control-sm font-monospace" id="time-in-${r.id}" value="${r.time_in || ''}" disabled></td>
                <td><input type="text" class="form-control form-control-sm font-monospace" id="lunch-out-${r.id}" value="${r.lunch_out || ''}" disabled></td>
                <td><input type="text" class="form-control form-control-sm font-monospace" id="lunch-in-${r.id}" value="${r.lunch_in || ''}" disabled></td>
                <td><input type="text" class="form-control form-control-sm font-monospace" id="time-out-${r.id}" value="${r.time_out || ''}" disabled></td>
                <td>
                    <button class="btn btn-warning btn-sm shadow-sm px-2 py-1 me-1" id="edit-btn-${r.id}" onclick="enableEditRecord('${r.id}')"><i class="bi bi-pencil-fill"></i></button>
                    <button class="btn btn-success btn-sm shadow-sm px-2 py-1 me-1 d-none" id="save-btn-${r.id}" onclick="saveTimeRecord('${r.id}')"><i class="bi bi-check-lg"></i></button>
                    <button class="btn btn-danger btn-sm shadow-sm px-2 py-1" onclick="deleteTimeRecord('${r.id}')"><i class="bi bi-trash-fill"></i></button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load records:', err);
    }
}

function enableEditRecord(id) {
    document.getElementById(`time-in-${id}`).disabled = false;
    document.getElementById(`lunch-out-${id}`).disabled = false;
    document.getElementById(`lunch-in-${id}`).disabled = false;
    document.getElementById(`time-out-${id}`).disabled = false;
    document.getElementById(`edit-btn-${id}`).classList.add('d-none');
    document.getElementById(`save-btn-${id}`).classList.remove('d-none');
}

async function saveTimeRecord(id) {
    const payload = {
        time_in: document.getElementById(`time-in-${id}`).value,
        lunch_out: document.getElementById(`lunch-out-${id}`).value,
        lunch_in: document.getElementById(`lunch-in-${id}`).value,
        time_out: document.getElementById(`time-out-${id}`).value
    };
    try {
        const res = await axios.put(`/api/records/${id}`, payload);
        if (res.data.success) {
            alert('Time record updated successfully!');
            loadTimeRecords();
        }
    } catch (err) {
        alert(err.response?.data?.error || 'Failed to update record.');
    }
}

async function deleteTimeRecord(id) {
    if (!confirm('Are you sure you want to delete this time record?')) return;
    try {
        await axios.delete(`/api/records/${id}`);
        loadTimeRecords();
    } catch (err) {
        alert('Failed to delete time record.');
    }
}

// Load Admin Users
async function loadAdminUsers() {
    const tbody = document.getElementById('admin-table-body');
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4"><i class="bi bi-shield-check text-success fs-4 me-2"></i> Authorized Administrator Active</td></tr>`;
}

async function deleteStaff(id) {
    if (!confirm('Are you sure you want to delete this staff member?')) return;
    try {
        await axios.delete(`/api/staff/${id}`);
        loadStaffMembers();
    } catch (err) {
        alert('Failed to delete staff member.');
    }
}

function exportRecords(period) {
    alert(`Exporting attendance records by ${period} initiated.`);
}