import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

let GEMINI_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID;
try {
    if (import.meta.env.PROD) {
        GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
        ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;
        ELEVENLABS_VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID;
    } else {
        const config = await import('./config.js');
        GEMINI_API_KEY = config.GEMINI_API_KEY;
        ELEVENLABS_API_KEY = config.ELEVENLABS_API_KEY;
        ELEVENLABS_VOICE_ID = config.ELEVENLABS_VOICE_ID;
    }
} catch (error) {
    console.error("Gagal memuat file konfigurasi (config.js). Pastikan file tersebut ada dan berisi API key yang benar.", error);
    addMessage("Error: Gagal memuat konfigurasi API. Periksa console untuk detail.", 'ai');
}

let scene, camera, renderer, clock;
let vrm;
let mixer; 
let animationActions = {}; 
let activeAction; 
let isTalking = false;
let audioPlayer; 
let audioContext;
let analyser;
let dataArray;
let audioSourceNode;

const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const chatContainer = document.getElementById('chat-container');
const typingIndicator = document.getElementById('typing-indicator');

init();
loadVRMModel();

window.addEventListener('load', () => {
    setTimeout(() => {
        addMessage("Halo! Aku AURA, teman virtualmu. Ada yang bisa aku bantu?", 'ai');
    }, 1000);
});

function init() {
    scene = new THREE.Scene();
    scene.background = null;
    
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.4, 2.5);
    camera.lookAt(0, 1.0, 0);

    const canvas = document.querySelector('#canvas');
    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 0, -5);
    scene.add(fillLight);

    clock = new THREE.Clock();
    
    audioPlayer = document.getElementById('audio-player');
    
    animate();
    
    window.addEventListener('resize', onWindowResize, false);
}
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
function loadVRMModel() {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const modelPath = './assets/IstriOrang.vrm';

    console.log('Loading VRM model from:', modelPath);

    loader.load(
        modelPath,
        (gltf) => {
            console.log('GLTF loaded:', gltf);
            
            vrm = gltf.userData.vrm;
            
            if (!vrm) {
                console.error('VRM data not found in GLTF');
                addMessage('Error: VRM data tidak ditemukan dalam file model', 'ai');
                return;
            }

            vrm.lookAt.autoUpdate = false;
            scene.add(vrm.scene);
            vrm.scene.rotation.y = Math.PI;
            
            console.log('VRM scene added to main scene');
            console.log("VRM Humanoid Bones:", vrm.humanoid.humanBones);

            mixer = new THREE.AnimationMixer(vrm.scene);
            loadAnimations();

            renderer.render(scene, camera);
            
            console.log('VRM model loaded and positioned successfully!');
        },
        (progress) => {
            const percent = Math.round(100.0 * (progress.loaded / progress.total));
            console.log(`Loading model... ${percent}%`);
        },
        (error) => {
            console.error('Error loading VRM model:', error);
            addMessage(`Gagal memuat model 3D. Error: ${error.message}`, 'ai');
        }
    );
}

const mixamoVRMRigMap = {
    'mixamorigHips': 'hips', 'mixamorigSpine': 'spine', 'mixamorigSpine1': 'chest', 'mixamorigSpine2': 'upperChest', 'mixamorigNeck': 'neck', 'mixamorigHead': 'head', 'mixamorigLeftShoulder': 'leftShoulder', 'mixamorigLeftArm': 'leftUpperArm', 'mixamorigLeftForeArm': 'leftLowerArm', 'mixamorigLeftHand': 'leftHand', 'mixamorigRightShoulder': 'rightShoulder', 'mixamorigRightArm': 'rightUpperArm', 'mixamorigRightForeArm': 'rightLowerArm', 'mixamorigRightHand': 'rightHand', 'mixamorigLeftUpLeg': 'leftUpperLeg', 'mixamorigLeftLeg': 'leftLowerLeg', 'mixamorigLeftFoot': 'leftFoot', 'mixamorigLeftToeBase': 'leftToes', 'mixamorigRightUpLeg': 'rightUpperLeg', 'mixamorigRightLeg': 'rightLowerLeg', 'mixamorigRightFoot': 'rightFoot', 'mixamorigRightToeBase': 'rightToes', 'mixamorigLeftHandThumb1': 'leftThumbMetacarpal', 'mixamorigLeftHandThumb2': 'leftThumbProximal', 'mixamorigLeftHandThumb3': 'leftThumbDistal', 'mixamorigLeftHandIndex1': 'leftIndexProximal', 'mixamorigLeftHandIndex2': 'leftIndexIntermediate', 'mixamorigLeftHandIndex3': 'leftIndexDistal', 'mixamorigLeftHandMiddle1': 'leftMiddleProximal', 'mixamorigLeftHandMiddle2': 'leftMiddleIntermediate', 'mixamorigLeftHandMiddle3': 'leftMiddleDistal', 'mixamorigLeftHandRing1': 'leftRingProximal', 'mixamorigLeftHandRing2': 'leftRingIntermediate', 'mixamorigLeftHandRing3': 'leftRingDistal', 'mixamorigLeftHandPinky1': 'leftLittleProximal', 'mixamorigLeftHandPinky2': 'leftLittleIntermediate', 'mixamorigLeftHandPinky3': 'leftLittleDistal', 'mixamorigRightHandThumb1': 'rightThumbMetacarpal', 'mixamorigRightHandThumb2': 'rightThumbProximal', 'mixamorigRightHandThumb3': 'rightThumbDistal', 'mixamorigRightHandIndex1': 'rightIndexProximal', 'mixamorigRightHandIndex2': 'rightIndexIntermediate', 'mixamorigRightHandIndex3': 'rightIndexDistal', 'mixamorigRightHandMiddle1': 'rightMiddleProximal', 'mixamorigRightHandMiddle2': 'rightMiddleIntermediate', 'mixamorigRightHandMiddle3': 'rightMiddleDistal', 'mixamorigRightHandRing1': 'rightRingProximal', 'mixamorigRightHandRing2': 'rightRingIntermediate', 'mixamorigRightHandRing3': 'rightRingDistal', 'mixamorigRightHandPinky1': 'rightLittleProximal', 'mixamorigRightHandPinky2': 'rightLittleIntermediate', 'mixamorigRightHandPinky3': 'rightLittleDistal',
};
function retargetAnimation(clip, vrmInstance) {
    const newTracks = [];
    for (const track of clip.tracks) {
        const trackSplits = track.name.split('.');
        const mixamoBoneName = trackSplits[0];
        const property = trackSplits[1];

        const vrmBoneName = mixamoVRMRigMap[mixamoBoneName];
        if (vrmBoneName) {
            const vrmNode = vrmInstance.humanoid.getRawBoneNode(vrmBoneName);
            if (vrmNode) {
                const newTrackName = `${vrmNode.name}.${property}`;
                track.name = newTrackName;
                newTracks.push(track);
            }
        }
    }
    clip.tracks = newTracks;
    return clip;
}

function makeAnimationInPlace(clip, vrmInstance) {
    const hipsNode = vrmInstance.humanoid.getRawBoneNode('hips');
    if (!hipsNode) return clip;

    const hipsNodeName = hipsNode.name;
    const positionTrackName = `${hipsNodeName}.position`;
    
    const positionTrack = clip.tracks.find(t => t.name === positionTrackName);

    if (positionTrack) {
        const firstFramePosition = {
            x: positionTrack.values[0],
            y: positionTrack.values[1],
            z: positionTrack.values[2]
        };

        for (let i = 0; i < positionTrack.values.length; i += 3) {
            positionTrack.values[i] -= firstFramePosition.x;
            positionTrack.values[i + 2] -= firstFramePosition.z;
        }
    }
    
    return clip;
}

function loadAnimations() {
    const fbxLoader = new FBXLoader();
    const animPath = './assets/animations/';

    fbxLoader.load(`${animPath}idle.fbx`, (object) => {
        console.log('Idle animation loaded');
        let idleClip = retargetAnimation(object.animations[0], vrm);
        idleClip = makeAnimationInPlace(idleClip, vrm);
        idleClip.name = 'idle';
        animationActions.idle = mixer.clipAction(idleClip);
        if (!activeAction) {
            activeAction = animationActions.idle;
            animationActions.idle.play();
        }
    }, undefined, (error) => console.error('Error loading idle animation:', error));

    fbxLoader.load(`${animPath}talking.fbx`, (object) => {
        console.log('Talking animation loaded');
        let talkingClip = retargetAnimation(object.animations[0], vrm);
        talkingClip = makeAnimationInPlace(talkingClip, vrm);
        talkingClip.name = 'talking';
        animationActions.talking = mixer.clipAction(talkingClip);
    }, undefined, (error) => console.error('Error loading talking animation:', error));
}

function switchAnimation(actionName) {
    if (activeAction === animationActions[actionName] || !animationActions[actionName]) {
        return;
    }
    
    const nextAction = animationActions[actionName];
    nextAction.reset().play();
    
    if (activeAction) {
        activeAction.crossFadeTo(nextAction, 0.3, true); 
    }
    
    activeAction = nextAction;
}

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();

    if (mixer) {
        mixer.update(delta);
    }

    if (vrm) {
        if (isTalking && analyser && vrm.expressionManager) {
            analyser.getByteFrequencyData(dataArray);
            
            let sum = 0;
            let count = 0;
            for (let i = 2; i < 50; i++) { sum += dataArray[i]; count++; }
            const averageAmplitude = sum / count;
            const normalizedAmplitude = averageAmplitude / 255;
            const mouthIntensity = Math.max(0, Math.min(1, normalizedAmplitude * 2));
            const currentMouthValue = vrm.expressionManager.getValue('a') || 0;
            const smoothedValue = currentMouthValue * 0.7 + mouthIntensity * 0.3;
            
            vrm.expressionManager.setValue('a', smoothedValue);
            
            if (mouthIntensity > 0.3) {
                const randomVariation = Math.random() * 0.2;
                if (Math.random() > 0.5) {
                    vrm.expressionManager.setValue('i', randomVariation);
                    vrm.expressionManager.setValue('u', 0);
                } else {
                    vrm.expressionManager.setValue('u', randomVariation);
                    vrm.expressionManager.setValue('i', 0);
                }
            } else {
                vrm.expressionManager.setValue('i', 0);
                vrm.expressionManager.setValue('u', 0);
            }
        } else if (vrm.expressionManager && !isTalking) {
            vrm.expressionManager.setValue('a', 0);
            vrm.expressionManager.setValue('i', 0);
            vrm.expressionManager.setValue('u', 0);
        }
    }

    renderer.render(scene, camera);
}

function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
    }
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!GEMINI_API_KEY || !ELEVENLABS_API_KEY) { addMessage('API Key belum diatur. Silakan cek file config.js atau Environment Variables.', 'ai'); return; }
    const userInput = chatInput.value.trim();
    if (!userInput) return;
    addMessage(userInput, 'user');
    chatInput.value = '';
    sendButton.disabled = true;
    typingIndicator.style.display = 'flex';
    chatContainer.scrollTop = chatContainer.scrollHeight;
    try {
        const aiResponseText = await getGeminiResponse(userInput);
        typingIndicator.style.display = 'none';
        addMessage(aiResponseText, 'ai');
        const audioBlob = await getElevenLabsAudio(aiResponseText);
        await playAudioWithMouthSync(audioBlob);
    } catch (error) {
        console.error('Error in chat flow:', error);
        typingIndicator.style.display = 'none';
        addMessage('Maaf, terjadi kesalahan. Coba lagi nanti. Lihat console untuk detail.', 'ai');
    } finally {
        sendButton.disabled = false;
    }
});

function addMessage(text, sender) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', `${sender}-message`);
    messageElement.innerText = text;
    chatContainer.insertBefore(messageElement, typingIndicator);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function getGeminiResponse(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("MASUKKAN")) { throw new Error("Gemini API Key tidak valid atau belum diatur di config.js."); }
    const modelName = 'gemini-1.5-flash-latest';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    const requestBody = { contents: [{ parts: [{ text: "Kamu adalah avatar perempuan bernama AURA. Jawablah pertanyaan dengan gaya yang ceria, ramah, dan sedikit gaul. Gunakan bahasa Indonesia yang santai, tapi nulis kata harus benar (jangan begini contoh : semuaa, kitaa, kamuu). Jangan terlalu panjang dan hanya gunakan tanda baca titik, koma, seru, dan tanda tanya. Jawab pertanyaan berikut: " + prompt }] }], safetySettings: [ { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" }, { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" }, { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" }, { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" } ] };
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
    const data = await response.json();
    if (!response.ok) { console.error("Gemini API Error Response:", data); throw new Error(`Gemini API error! status: ${response.status}. Pesan: ${data.error?.message || 'Unknown error'}`); }
    if (!data.candidates || data.candidates.length === 0) { console.warn("Gemini response was blocked or empty.", data); return "Hmm, sepertinya aku tidak bisa menjawab itu. Mungkin karena filter keamanan. Coba tanya yang lain ya!"; }
    return data.candidates[0].content.parts[0].text;
}

async function getElevenLabsAudio(text) {
    if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY.includes("MASUKKAN")) { throw new Error("ElevenLabs API Key tidak valid atau belum diatur di config.js."); }
    const apiUrl = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;
    const requestBody = { text: text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75, }, };
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVENLABS_API_KEY, }, body: JSON.stringify(requestBody), });
    if (!response.ok) { const errorData = await response.text(); console.error("ElevenLabs API Error Response:", errorData); throw new Error(`ElevenLabs API error! status: ${response.status}`); }
    return response.blob();
}

function playAudioWithMouthSync(audioBlob) {
    return new Promise((resolve, reject) => {
        initAudioContext();
        if (audioContext.state === 'suspended') { audioContext.resume().catch(e => console.error("Gagal melanjutkan AudioContext:", e)); }
        if (!audioSourceNode) {
            try {
                audioSourceNode = audioContext.createMediaElementSource(audioPlayer);
                audioSourceNode.connect(analyser);
                analyser.connect(audioContext.destination);
                console.log("Koneksi Web Audio API berhasil dibuat.");
            } catch (e) { console.error("Gagal membuat koneksi Web Audio API:", e); reject(e); return; }
        }
        if (audioPlayer.src.startsWith('blob:')) { URL.revokeObjectURL(audioPlayer.src); }
        const audioUrl = URL.createObjectURL(audioBlob);
        audioPlayer.src = audioUrl;
        audioPlayer.onended = null;
        audioPlayer.onerror = null;
        audioPlayer.onended = () => { isTalking = false; switchAnimation('idle'); resolve(); };
        audioPlayer.onerror = (err) => { isTalking = false; switchAnimation('idle'); console.error('Audio playback error:', err); reject(err); };
        isTalking = true;
        switchAnimation('talking');
        audioPlayer.play().catch(e => { isTalking = false; switchAnimation('idle'); console.error("Audio play failed:", e); reject(e); });
    });
}