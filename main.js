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
let audioContext;
let analyser;
let dataArray;
let source;
let isAudioConnected = false;

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

            scene.add(vrm.scene);
            
            vrm.scene.position.set(0, 0, 0);
            vrm.scene.rotation.set(0, 0, 0);
            vrm.scene.scale.set(1, 1, 1);
            
            vrm.scene.rotation.y = Math.PI;
            
            vrm.scene.position.y = 0.5;
            
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
        
        if (isTalking && analyser && vrm.expressionManager) {
            analyser.getByteFrequencyData(dataArray);
            
            let sum = 0;
            let count = 0;
            
            for (let i = 2; i < 50; i++) {
                sum += dataArray[i];
                count++;
            }
            
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
        await playAudioWithMouthSync(audioBlob);
        
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
                text: "Kamu adalah avatar perempuan bernama AURA. Jawablah pertanyaan dengan gaya yang ceria, ramah, dan sedikit gaul. Gunakan bahasa Indonesia yang santai, tapi nulis kata harus benar (jangan begini contoh : semuaa, kitaa, kamuu). Jangan terlalu panjang dan hanya gunakan tanda baca titik, koma, seru, dan tanda tanya. Jawab pertanyaan berikut: " + prompt
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

function playAudioWithMouthSync(audioBlob) {
    return new Promise((resolve, reject) => {
        initAudioContext();
        
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
        
        if (source) {
            try {
                source.disconnect();
            } catch (e) {
                console.log('Source already disconnected');
            }
            source = null;
        }
        
        const audioUrl = URL.createObjectURL(audioBlob);
        audio = new Audio(audioUrl);
        audio.crossOrigin = 'anonymous';
        isAudioConnected = false;
        
        audio.oncanplaythrough = () => {
            try {
                if (!isAudioConnected) {
                    source = audioContext.createMediaElementSource(audio);
                    source.connect(analyser);
                    analyser.connect(audioContext.destination);
                    isAudioConnected = true;
                }
                
                isTalking = true;
                audio.play().catch(e => {
                    console.error("Audio play failed:", e);
                    isTalking = false;
                    reject(e);
                });
            } catch (e) {
                console.error("Audio context setup failed:", e);
                isTalking = false;
                reject(e);
            }
        };
        
        audio.onended = () => {
            isTalking = false;
            isAudioConnected = false;
            URL.revokeObjectURL(audioUrl);
            resolve();
        };
        
        audio.onerror = (err) => {
            isTalking = false;
            isAudioConnected = false;
            URL.revokeObjectURL(audioUrl);
            console.error('Audio playback error:', err);
            reject(err);
        };
        
        audio.onloadeddata = () => {
            if (audio.readyState >= 2 && !isAudioConnected) {
                audio.oncanplaythrough();
            }
        };
    });
}