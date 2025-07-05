import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

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
let isTalking = false;
let audio;

const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const chatContainer = document.getElementById('chat-container');

init();
loadVRMModel();

function init() {
    scene = new THREE.Scene();
    scene.background = null;
    
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 2.5);
    camera.lookAt(0, 1.3, 0);

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

    const modelPath = './models/IstriOrang.vrm';

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

            scene.add(vrm.scene);
            
            vrm.scene.position.set(0, 0, 0);
            vrm.scene.rotation.set(0, 0, 0);
            vrm.scene.scale.set(1, 1, 1);
            
            vrm.scene.rotation.y = Math.PI;
            
            vrm.scene.position.y = 2;
            
            console.log('VRM scene added to main scene');
            console.log('Scene children count:', scene.children.length);
            console.log('VRM scene position:', vrm.scene.position);
            console.log('VRM scene rotation:', vrm.scene.rotation);
            console.log('VRM scene scale:', vrm.scene.scale);
            
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

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();

    if (vrm) {
        vrm.update(delta);
        
        const basePosition = 0.7;
        const time = Date.now() * 0.001;
        
        if (isTalking) {
            vrm.scene.position.y = basePosition + Math.sin(time * 5) * 0.02;
            
            const mouthOpen = 0.3 + 0.7 * Math.sin(time * 10);
            if (vrm.expressionManager) {
                vrm.expressionManager.setValue('a', mouthOpen);
            }
        } else {
            vrm.scene.position.y = basePosition + Math.sin(time * 2) * 0.01;
            
            if (vrm.expressionManager) {
                vrm.expressionManager.setValue('a', 0);
            }
        }
    }

    renderer.render(scene, camera);
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!GEMINI_API_KEY || !ELEVENLABS_API_KEY) {
        addMessage('API Key belum diatur. Silakan cek file config.js atau Environment Variables.', 'ai');
        return;
    }
    
    const userInput = chatInput.value.trim();
    if (!userInput) return;
    
    addMessage(userInput, 'user');
    chatInput.value = '';
    sendButton.disabled = true;
    sendButton.innerText = '...';
    
    try {
        const aiResponseText = await getGeminiResponse(userInput);
        addMessage(aiResponseText, 'ai');
        
        const audioBlob = await getElevenLabsAudio(aiResponseText);
        await playAudioAndAnimate(audioBlob);
    } catch (error) {
        console.error('Error in chat flow:', error);
        addMessage('Maaf, terjadi kesalahan. Coba lagi nanti. Lihat console untuk detail.', 'ai');
    } finally {
        sendButton.disabled = false;
        sendButton.innerText = 'Kirim';
    }
});

function addMessage(text, sender) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', `${sender}-message`);
    messageElement.innerText = text;
    chatContainer.appendChild(messageElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function getGeminiResponse(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("MASUKKAN")) {
        throw new Error("Gemini API Key tidak valid atau belum diatur di config.js.");
    }
    
    const modelName = 'gemini-1.5-flash-latest';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    
    const requestBody = {
        contents: [{
            parts: [{
                text: "Kamu adalah VTuber perempuan bernama AURA dari Indonesia. Jawablah pertanyaan dengan gaya yang ceria, ramah, dan sedikit gaul. Gunakan bahasa Indonesia yang santai. Jangan gunakan tanda asteris (*) untuk menandai tindakan. Jawab pertanyaan berikut: " + prompt
            }]
        }],
        safetySettings: [
            { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
        ]
    };
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
        console.error("Gemini API Error Response:", data);
        throw new Error(`Gemini API error! status: ${response.status}. Pesan: ${data.error?.message || 'Unknown error'}`);
    }
    
    if (!data.candidates || data.candidates.length === 0) {
        console.warn("Gemini response was blocked or empty.", data);
        return "Hmm, sepertinya aku tidak bisa menjawab itu. Mungkin karena filter keamanan. Coba tanya yang lain ya!";
    }
    
    return data.candidates[0].content.parts[0].text;
}

async function getElevenLabsAudio(text) {
    if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY.includes("MASUKKAN")) {
        throw new Error("ElevenLabs API Key tidak valid atau belum diatur di config.js.");
    }
    
    const apiUrl = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;
    const requestBody = {
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
        },
    };
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
        const errorData = await response.text();
        console.error("ElevenLabs API Error Response:", errorData);
        throw new Error(`ElevenLabs API error! status: ${response.status}`);
    }
    
    return response.blob();
}

function playAudioAndAnimate(audioBlob) {
    return new Promise((resolve, reject) => {
        if (audio) {
            audio.pause();
        }
        
        const audioUrl = URL.createObjectURL(audioBlob);
        audio = new Audio(audioUrl);
        
        audio.oncanplaythrough = () => {
            isTalking = true;
            audio.play().catch(e => {
                console.error("Audio play failed:", e);
                isTalking = false;
                reject(e);
            });
        };
        
        audio.onended = () => {
            isTalking = false;
            URL.revokeObjectURL(audioUrl);
            resolve();
        };
        
        audio.onerror = (err) => {
            isTalking = false;
            URL.revokeObjectURL(audioUrl);
            console.error('Audio playback error:', err);
            reject(err);
        };
    });
}