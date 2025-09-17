import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

let scene, camera, renderer, clock;
let vrm;
let audioPlayer;
let GEMINI_API_KEY, VOICEVOX_API_KEY;
let chatHistory = [];
let mixer;
const animations = {};
let currentAction;

const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const chatContainer = document.getElementById('chat-container');
const typingIndicator = document.getElementById('typing-indicator');

const SPEAKER_ID = 14;

const SYSTEM_INSTRUCTION = {
    role: "model",
    parts: [{
        text: "Kamu adalah AURA, avatar perempuan yang ceria, ramah, dan sedikit gaul. Selalu jawab dalam bahasa Indonesia informal yang santai dan gunakan kosakata yang baku (sesuai KBBI). Jangan pernah keluar dari peranmu sebagai AURA. Responsmu harus singkat dan langsung ke intinya."
    }]
};

async function main() {
    try {
        const config = await import('./config.js');
        GEMINI_API_KEY = config.GEMINI_API_KEY;
        VOICEVOX_API_KEY = config.VOICEVOX_API_KEY;

        if (!VOICEVOX_API_KEY || VOICEVOX_API_KEY === "KEY_ANDA_DARI_WEBSITE") {
             addMessage("Error: API Key Voicevox belum diatur di config.js.", 'ai');
             console.error("API Key Voicevox belum diatur di config.js.");
             return;
        }

    } catch (error) {
        console.error("Gagal memuat config.js. Pastikan file ada dan benar.", error);
        addMessage("Error: Gagal memuat file konfigurasi API Key.", 'ai');
        return;
    }

    initScene();
    await loadVRMModel();
    animate();
}

function initScene() {
    scene = new THREE.Scene();
    clock = new THREE.Clock();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.1, 1.8);
    camera.lookAt(0, 0.7, 0);

    const canvas = document.querySelector('#canvas');
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 10, 5);
    scene.add(directionalLight);

    audioPlayer = document.getElementById('audio-player');
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function loadVRMModel() {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        loader.load('./assets/IstriOrang.vrm',
            (gltf) => {
                vrm = gltf.userData.vrm;
                scene.add(vrm.scene);
                console.log('Model VRM berhasil dimuat.');
                mixer = new THREE.AnimationMixer(vrm.scene);
                loadAnimations();
                resolve();
            },
            undefined,
            (error) => {
                console.error("Gagal memuat model VRM:", error);
                addMessage(`Gagal memuat model 3D. Cek console (F12) untuk detail.`, 'ai');
                reject(error);
            }
        );
    });
}

function retarget(animationClip, fbx) {
    const tracks = [];
    const vrmHipsNode = vrm.humanoid.getRawBoneNode('hips');
    const mixamoHipsNode = fbx.getObjectByName('mixamorigHips');

    if (!vrmHipsNode || !mixamoHipsNode) {
        console.error("Tulang pinggul (hips) tidak ditemukan.");
        return animationClip;
    }

    const vrmHipsMatrix = vrmHipsNode.matrixWorld.clone();
    const mixamoHipsMatrix = mixamoHipsNode.matrixWorld.clone();

    const vrmHipsQuat = new THREE.Quaternion().setFromRotationMatrix(vrmHipsMatrix);
    const mixamoHipsQuat = new THREE.Quaternion().setFromRotationMatrix(mixamoHipsMatrix);

    const fixRot = vrmHipsQuat.multiply(mixamoHipsQuat.invert());

    const mixamoVrmMap = {
        'mixamorigHips': 'hips', 'mixamorigSpine': 'spine', 'mixamorigSpine1': 'chest',
        'mixamorigSpine2': 'upperChest', 'mixamorigNeck': 'neck', 'mixamorigHead': 'head',
        'mixamorigLeftShoulder': 'leftShoulder', 'mixamorigLeftArm': 'leftUpperArm',
        'mixamorigLeftForeArm': 'leftLowerArm', 'mixamorigLeftHand': 'leftHand',
        'mixamorigRightShoulder': 'rightShoulder', 'mixamorigRightArm': 'rightUpperArm',
        'mixamorigRightForeArm': 'rightLowerArm', 'mixamorigRightHand': 'rightHand',
        'mixamorigLeftUpLeg': 'leftUpperLeg', 'mixamorigLeftLeg': 'leftLowerLeg',
        'mixamorigLeftFoot': 'leftFoot', 'mixamorigLeftToeBase': 'leftToes',
        'mixamorigRightUpLeg': 'rightUpperLeg', 'mixamorigRightLeg': 'rightLowerLeg',
        'mixamorigRightFoot': 'rightFoot', 'mixamorigRightToeBase': 'rightToes',
    };

    animationClip.tracks.forEach(track => {
        const trackNameParts = track.name.split('.');
        const mixamoBoneName = trackNameParts[0];
        const vrmBoneName = mixamoVrmMap[mixamoBoneName];

        if (vrmBoneName) {
            const vrmBoneNode = vrm.humanoid.getRawBoneNode(vrmBoneName);
            if (vrmBoneNode) {
                const newTrack = track.clone();
                if (newTrack.name.endsWith('.quaternion')) {
                    if (vrmBoneName === 'hips') {
                        for (let i = 0; i < newTrack.values.length; i += 4) {
                            const quaternion = new THREE.Quaternion().fromArray(newTrack.values, i);
                            quaternion.premultiply(fixRot);
                            quaternion.toArray(newTrack.values, i);
                        }
                    }
                }
                newTrack.name = `${vrmBoneNode.name}.${trackNameParts[1]}`;
                tracks.push(newTrack);
            }
        }
    });

    return new THREE.AnimationClip(animationClip.name, animationClip.duration, tracks);
}


async function loadAnimations() {
    const fbxLoader = new FBXLoader();
    try {
        const idleFbx = await fbxLoader.loadAsync('./assets/animations/Idle.fbx');
        const idleClip = retarget(idleFbx.animations[0], idleFbx);
        animations['idle'] = mixer.clipAction(idleClip);
        animations['idle'].loop = THREE.LoopRepeat;

        const talkFbx = await fbxLoader.loadAsync('./assets/animations/Talking.fbx');
        const talkClip = retarget(talkFbx.animations[0], talkFbx);
        animations['talk'] = mixer.clipAction(talkClip);
        animations['talk'].loop = THREE.LoopRepeat;
        
        console.log('Animasi berhasil dimuat dan diremap.');
        playAnimation('idle');

    } catch (error) {
        console.error("Gagal memuat file animasi:", error);
        addMessage("Gagal memuat animasi. Avatar mungkin tidak bergerak.", 'ai');
    }
}

function playAnimation(name) {
    if (currentAction === animations[name]) return;
    const newAction = animations[name];
    if (!newAction) {
        console.warn(`Animasi "${name}" tidak ditemukan.`);
        return;
    }
    if (currentAction) {
        currentAction.fadeOut(0.5);
    }
    newAction.reset().setEffectiveWeight(1).fadeIn(0.5).play();
    currentAction = newAction;
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (vrm) vrm.update(delta);
    if (mixer) mixer.update(delta);
    renderer.render(scene, camera);
}

main();

window.addEventListener('load', () => {
    setTimeout(() => {
        addMessage("Haiii! Aku AURA, senang banget ketemu kamu! Ada yang bisa kubantu? Apa pertanyaanmu? 😊", 'ai');
    }, 1000);
});

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userInput = chatInput.value.trim();
    if (!userInput || !GEMINI_API_KEY) return;
    addMessage(userInput, 'user');
    chatInput.value = '';
    sendButton.disabled = true;
    typingIndicator.style.display = 'flex';
    try {
        const aiResponseText = await getGeminiResponse(userInput);
        typingIndicator.style.display = 'none';
        addMessage(aiResponseText, 'ai');
        const translatedText = await translateToJapanese(aiResponseText);
        console.log(`Teks terjemahan: ${translatedText}`);
        const audioBlob = await getTtsAudio(translatedText);
        await playAudio(audioBlob);
    } catch (error) {
        console.error('Error in chat flow:', error);
        typingIndicator.style.display = 'none';
        addMessage('Maaf, terjadi kesalahan. Coba lagi nanti.', 'ai');
    } finally {
        sendButton.disabled = false;
        chatInput.focus();
    }
});

function addMessage(text, sender) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', `${sender}-message`);
    messageElement.innerText = text;
    chatContainer.insertBefore(messageElement, typingIndicator);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function translateToJapanese(text) {
    if (!text) return "";
    try {
        const cleanText = text.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '');
        const encodedText = encodeURIComponent(cleanText);
        const apiUrl = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=id|ja`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`Translation API error! status: ${response.status}`);
        const data = await response.json();
        return data.responseData.translatedText;
    } catch (error) {
        console.error("Translation Error:", error);
        return "ごめんなさい、エラーが発生しました。";
    }
}

async function getGeminiResponse(userInput) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    chatHistory.push({ role: "user", parts: [{ text: userInput }] });
    const historyLimit = 10;
    const recentHistory = chatHistory.length > historyLimit ? chatHistory.slice(-historyLimit) : chatHistory;
    const requestBody = {
        contents: recentHistory,
        systemInstruction: SYSTEM_INSTRUCTION,
        safetySettings: [
            { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
        ]
    };
    try {
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
        const data = await response.json();
        if (!response.ok || !data.candidates || data.candidates.length === 0) {
            console.error("Gemini API Error:", data);
            chatHistory.pop();
            return "Aduh, maaf, sepertinya aku sedang sedikit pusing. Coba tanya lagi nanti, ya!";
        }
        const aiResponseText = data.candidates[0].content.parts[0].text;
        chatHistory.push({ role: "model", parts: [{ text: aiResponseText }] });
        return aiResponseText;
    } catch (error) {
        console.error("Error getting Gemini response:", error);
        chatHistory.pop();
        return "Waduh, koneksiku sedang eror. Bisa tanya lagi?";
    }
}

async function getTtsAudio(text) {
    if (!text) return new Blob();
    console.log(`Using Speaker ID: ${SPEAKER_ID} (Meimei Himari)`);
    const params = new URLSearchParams({
        key: VOICEVOX_API_KEY,
        speaker: SPEAKER_ID,
        text: text,
    });
    const apiUrl = `https://deprecatedapis.tts.quest/v2/voicevox/audio/?${params.toString()}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            const errorResult = await response.json();
            throw new Error(`Voicevox API error! status: ${response.status}. Pesan: ${errorResult.error}`);
        }
        return response.blob();
    } catch (error) {
        console.error("Voicevox API Error:", error);
        addMessage("Duh, maaf, suaraku sedang ada gangguan. Coba lagi nanti, ya!", 'ai');
        return new Blob();
    }
}

function playAudio(audioBlob) {
    if (audioBlob.size === 0) {
        console.warn("Skipping audio playback due to empty audio blob.");
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const audioUrl = URL.createObjectURL(audioBlob);
        audioPlayer.src = audioUrl;
        audioPlayer.onended = () => { 
            URL.revokeObjectURL(audioUrl); 
            playAnimation('idle');
            resolve(); 
        };
        audioPlayer.onerror = (err) => { 
            URL.revokeObjectURL(audioUrl); 
            playAnimation('idle');
            reject(err); 
        };
        audioPlayer.play()
            .then(() => {
                playAnimation('talk');
            })
            .catch(reject);
    });
}