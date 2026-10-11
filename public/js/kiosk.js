// ==================== ATTENDANCE KIOSK SCRIPT ====================
const video = document.getElementById('webcam');
const statusText = document.getElementById('scan-status');
let labeledFaceDescriptors = [];
let faceMatcher = null;
let isScanning = false;

function updateStatus(msg) {
    console.log(msg);
    if (statusText) statusText.innerText = msg;
}

// Start Philippine Clock immediately
setInterval(() => {
    const options = { timeZone: 'Asia/Manila', hour12: true, dateStyle: 'full', timeStyle: 'medium' };
    const clockEl = document.getElementById('ph-clock');
    if (clockEl) clockEl.innerText = new Date().toLocaleString('en-US', options);
}, 1000);

// Initialize Kiosk Execution
(async function initKiosk() {
    try {
        updateStatus('Step 1: Requesting webcam access...');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (video) {
            video.srcObject = stream;
            await video.play();
        }

        updateStatus('Step 2: Loading AI Recognition Models...');
        if (typeof faceapi === 'undefined') {
            throw new Error('face-api library not loaded from CDN.');
        }

        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

        updateStatus('Step 3: Loading staff database...');
        await loadStaffFaceData();

        if (!faceMatcher) {
            updateStatus('⚠️ Error: No staff face descriptors found! Register staff in Admin Portal first.');
            return;
        }

        updateStatus('System ready. Position your face in front of the camera...');
        startFaceRecognitionLoop();
    } catch (err) {
        console.error('Kiosk Init Error:', err);
        updateStatus(`Error: ${err.message}`);
    }
})();

// Mode Switcher (Face Recognition vs Manual Entry)
function switchMode(mode) {
    const faceSec = document.getElementById('section-face');
    const manualSec = document.getElementById('section-manual');
    const btnFace = document.getElementById('btn-mode-face');
    const btnManual = document.getElementById('btn-mode-manual');

    if (mode === 'face') {
        if (faceSec) faceSec.classList.remove('d-none');
        if (manualSec) manualSec.classList.add('d-none');
        if (btnFace) btnFace.classList.add('active', 'btn-light');
        if (btnFace) btnFace.classList.remove('btn-outline-light');
        if (btnManual) btnManual.classList.remove('active', 'btn-light');
        if (btnManual) btnManual.classList.add('btn-outline-light');
    } else {
        if (faceSec) faceSec.classList.add('d-none');
        if (manualSec) manualSec.classList.remove('d-none');
        if (btnManual) btnManual.classList.add('active', 'btn-light');
        if (btnManual) btnManual.classList.remove('btn-outline-light');
        if (btnFace) btnFace.classList.remove('active', 'btn-light');
        if (btnFace) btnFace.classList.add('btn-outline-light');
    }
}

// Load Registered Staff Face Descriptors from Database
async function loadStaffFaceData() {
    try {
        const res = await axios.get('/api/staff');
        const staffList = res.data;

        labeledFaceDescriptors = staffList.map(staff => {
            if (!staff.face_descriptor) return null;
            try {
                let descriptorArr = staff.face_descriptor;
                
                if (typeof descriptorArr === 'string') {
                    descriptorArr = JSON.parse(descriptorArr);
                    if (typeof descriptorArr === 'string') {
                        descriptorArr = JSON.parse(descriptorArr);
                    }
                }

                if (!Array.isArray(descriptorArr) || descriptorArr.length !== 128) {
                    console.warn(`Skipping staff ${staff.delta_code}: invalid descriptor length (${descriptorArr?.length}).`);
                    return null;
                }
                
                return new faceapi.LabeledFaceDescriptors(
                    staff.delta_code, 
                    [new Float32Array(descriptorArr)]
                );
            } catch (e) {
                console.error(`Error parsing descriptor for ${staff.delta_code}:`, e);
                return null;
            }
        }).filter(Boolean);

        if (labeledFaceDescriptors.length > 0) {
            faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.65);
            console.log(`Successfully loaded ${labeledFaceDescriptors.length} staff face descriptors.`);
        } else {
            console.warn('No valid face descriptors found for any staff member.');
        }
    } catch (err) {
        console.error('Failed to load staff face descriptors:', err);
    }
}

// Continuous Face Recognition Scanning Loop with Live Feedback
function startFaceRecognitionLoop() {
    if (isScanning) return;
    isScanning = true;

    setInterval(async () => {
        if (!video || video.paused || video.ended || !faceMatcher || typeof faceapi === 'undefined') return;

        try {
            const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (!detections) {
                updateStatus('Scanning for face...');
                return;
            }

            const bestMatch = faceMatcher.findBestMatch(detections.descriptor);
            console.log('Match result:', bestMatch.toString());

            if (bestMatch.label === 'unknown') {
                updateStatus(`Face detected: Unknown (Score: ${bestMatch.distance.toFixed(2)}) - Re-register in Admin Panel`);
            } else {
                updateStatus(`Recognized: ${bestMatch.label}! Logging attendance...`);
                
                // Capture snapshot frame from video element
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;
                canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                const captured_photo_base64 = canvas.toDataURL('image/jpeg', 0.85);

                await submitScan(bestMatch.label, captured_photo_base64);
                
                await new Promise(resolve => setTimeout(resolve, 5000));
                updateStatus('Position your face in front of the camera...');
            }
        } catch (err) {
            console.error('Detection loop error:', err);
            updateStatus(`Scan error: ${err.message}`);
        }
    }, 1500);
}

// Manual Entry Submission
async function submitManualEntry() {
    const delta_code = document.getElementById('manual-delta').value;
    if (!delta_code) return alert('Please enter a Delta Code.');

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const captured_photo_base64 = canvas.toDataURL('image/jpeg', 0.85);

    await submitScan(delta_code, captured_photo_base64);
    document.getElementById('manual-delta').value = '';
}

// API Request Handler for Scans with Snapshot Photo
async function submitScan(delta_code, captured_photo_base64) {
    try {
        const res = await axios.post('/api/kiosk/scan', {
            delta_code,
            captured_photo_base64
        });

        if (res.data.success) {
            updateStatus(`Success: ${res.data.message}`);
            alert(res.data.message);
        } else {
            updateStatus(`Server Error: ${res.data.error}`);
        }
    } catch (err) {
        const errorMsg = err.response?.data?.error || 'Scan request failed.';
        updateStatus(`Network Error: ${errorMsg}`);
    }
}