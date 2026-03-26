// Three JS Modules
import * as THREE from "three";

import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { AnimationMixer } from "three";

// Post Processing
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// Debugging Tools
import Stats from "three/examples/jsm/libs/stats.module.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";

// Particle System File
import { getParticleSystem } from "./getParticleSystem.js";

let camera, scene, renderer, composer, controls, model;
let modelCircle, baseCircle;
let gui, guiCam;
let room; // Oda objesi
let isLocked = false; // Pointer lock durumu
let currentInteractable = null; // Şu an bakılan etkileşimli obje
let interactionHintDiv; // E tuşu ipucu elementi
window.isDoorOpen = false; // Kapı durumu
window.doorGroup = null; // Kapı objesi referansı
let handsGroup; // Procedural hands group

let mixerSmoke, mixerFire, mixerFE;
let modelSmoke, modelFire, modelFE, modelWood;
const clock = new THREE.Clock();
let deltaTime;

// Göz hizası sabit yüksekliği (metre cinsinden)
const EYE_HEIGHT = 1.6;

// ==================== FPS HAREKET KONTROLLERİ (WASD) ====================
// Klavye ile birinci şahıs (kişi POV) hareketi için değişkenler
const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

// Hareket hızı (metre/saniye)
const moveSpeed = 2.5;

function onKeyDown(event) {
  switch (event.code) {
    case "KeyW":
      moveState.forward = true;
      break;
    case "KeyS":
      moveState.backward = true;
      break;
    case "KeyA":
      moveState.left = true;
      break;
    case "KeyD":
      moveState.right = true;
      break;
    case "KeyE":
      if (event.repeat) return;
      if (currentInteractable) {
        handleInteraction(currentInteractable);
      }
      break;
  }
}

// Etkileşim işleyicisi
function handleInteraction(object) {
  if (object.name === "alarmBox") {
    activateAlarm();
  } else if (
    object.name === "ABC" ||
    object.name === "CO2" ||
    object.name === "WATER"
  ) {
    selectExtinguisher(object.name);
  } else if (object.userData && object.userData.isFireHandle) {
    toggleFireExtinguisher();
  } else if ((object.name === "trashcan" || object.name === "fireHitbox" || object.name === "heater") && selectedExtinguisher) {
    // Yangın söndürme eylemi
    toggleFireExtinguisher();
  } else if (object.name === "Door") {
    // Kapı aç/kapat
    toggleDoor();
  }
}

function toggleDoor() {
  if (!window.doorGroup) return;

  window.isDoorOpen = !window.isDoorOpen;

  // Basit rotasyon animasyonu
  if (window.isDoorOpen) {
    // Aç (İçeri veya dışarı, -90 derece diyelim)
    // Menteşe solda, içeri açılsın
    window.doorGroup.rotation.y = -Math.PI / 2;
    showMessage("🚪 Kapı Açıldı", 1000);
  } else {
    // Kapat
    window.doorGroup.rotation.y = 0;
    showMessage("🚪 Kapı Kapandı", 1000);
  }
}

function onKeyUp(event) {
  switch (event.code) {
    case "KeyW":
      moveState.forward = false;
      break;
    case "KeyS":
      moveState.backward = false;
      break;
    case "KeyA":
      moveState.left = false;
      break;
    case "KeyD":
      moveState.right = false;
      break;
  }
}

// Oda içi sınır için yardımcı fonksiyon (GÜNCELLENDİ: Kapı ve Dışarı Çıkış)
function clampInsideRoom(position) {
  const roomHalfSize = 2.4; // Yan ve arka duvarlar
  const wallZ = 2.5; // Ön duvar (Kapı duvarı)
  const outsideLimitZ = 6.0; // Dışarıda gidilebilecek son nokta
  const doorHalfWidth = 0.5; // Kapı genişliğinin yarısı (1m kapı)

  // X Sınırları (Oda genişliği - Dışarıda da aynı genişlikte koridor varsayalım)
  if (position.x > roomHalfSize) position.x = roomHalfSize;
  if (position.x < -roomHalfSize) position.x = -roomHalfSize;

  // Z Sınırları (Arka duvar ve Dış sınır)
  if (position.z < -roomHalfSize) position.z = -roomHalfSize;
  if (position.z > outsideLimitZ) position.z = outsideLimitZ;

  // Ön Duvar Kontrolü (Z = 2.5 civarı)
  // Eğer duvara yaklaşıyorsa
  if (position.z > 2.2 && position.z < 2.8) {
    const inDoorway = Math.abs(position.x) < doorHalfWidth;

    if (!inDoorway) {
      // Kapı hizasında değiliz - Duvar var
      if (position.z < wallZ) position.z = 2.2; // İçeride kal
      else position.z = 2.8; // Dışarıda kal
    } else {
      // Kapı hizasındayız
      if (!window.isDoorOpen) {
        // Kapı kapalı - Geçiş yok
        if (position.z < wallZ) position.z = 2.2;
        else position.z = 2.8;
      }
      // Kapı açıksa geçebiliriz
    }
  }
}

function updateFirstPersonMovement(delta) {
  // Sadece kilitliyse (senaryo başladığında kilitleniyor) harekete izin ver
  if (!controls.isLocked) return;

  // Hiçbir tuşa basılmıyorsa çık
  if (
    !moveState.forward &&
    !moveState.backward &&
    !moveState.left &&
    !moveState.right
  ) {
    return;
  }

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  // Y eksenini sıfırla ki sadece yatay düzlemde hareket etsin
  direction.y = 0;
  direction.normalize();

  // Sağ/sol yön vektörü (strafe) - dünya yukarı ekseni ile çarpım
  const strafe = new THREE.Vector3();
  strafe.crossVectors(direction, camera.up).normalize();

  const velocity = new THREE.Vector3();

  if (moveState.forward) {
    velocity.add(direction);
  }
  if (moveState.backward) {
    velocity.sub(direction);
  }
  if (moveState.left) {
    velocity.sub(strafe);
  }
  if (moveState.right) {
    velocity.add(strafe);
  }

  if (velocity.lengthSq() === 0) return;

  velocity.normalize().multiplyScalar(moveSpeed * delta);

  // Kamera ve hedef (controls.target) birlikte taşınmalı ki FPS hissi bozulmasın
  camera.position.add(velocity);

  // Kamerayı oda içinde tut
  clampInsideRoom(camera.position);

  // Yüksekliği sabitle (göz hizası sabit kalsın)
  camera.position.y = EYE_HEIGHT;
}

// Ses sistemı
let alarmSound;

// Performans ayarları
const statsEnable = false; // FPS için istatistik panelini kapat
const guiEnable = false;
const toneMapping = THREE.ACESFilmicToneMapping;
const antialiasing = false;
const AmbientOcclusion = false;
// Masa/bilgisayar bölgesinde kasmayı azaltmak için gölge ve env yansımasını kapat
const SHADOWS_ENABLED = false;
const ENV_REFLECTION_ENABLED = false;

const loader = new GLTFLoader().setPath("/assets/3D/");
const texLoader = new THREE.TextureLoader().setPath("/assets/textures/");
const hdriLoader = new RGBELoader().setPath("/assets/hdri/");

const fileFE = "FE8.glb";
const fileBase = "circle.glb";

// ==================== GERÇEKÇİ 3D MODEL YAPILANDIRMASI ====================
// Bu modelleri assets/3D/ klasörüne indirin
// Önerilen kaynaklar: Sketchfab, Poly Pizza, CGTrader (ücretsiz bölüm)
const REALISTIC_MODELS = {
  // Ofis Masası - basit ahşap masa
  desk: {
    file: "office_desk.glb",
    position: { x: 0, y: 0, z: -1.5 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  },
  // Bilgisayar Monitörü
  monitor: {
    file: "computer_monitor.glb",
    position: { x: 0, y: 0.9, z: -2 },
    scale: { x: 0.3, y: 0.3, z: 0.3 },
    rotation: { x: 0, y: 0, z: 0 },
  },
  // Klavye
  keyboard: {
    file: "mouse_and_keyboard.glb",
    position: { x: -0.2, y: 1.1, z: -1.45 },
    scale: { x: 0.07, y: 0.07, z: 0.07 },
    rotation: { x: 0, y: 0, z: 0 },
  },

  // Isıtıcı (Heater)
  heater: {
    file: "simple_heater.glb",
    position: { x: 0.7, y: 0.20, z: -1.5 },
    scale: { x: 0.05, y: 0.05, z: 0.05 },
    rotation: { x: 0, y: -Math.PI / 2, z: 0 },
  },
  // Yangın Alarm Butonu - GİRİŞE YAKIN (sol duvar, ön taraf)
  alarmButton: {
    file: "fire_alarm.glb",
    position: { x: -2.4, y: 1.4, z: 1.8 }, // Girişe yakın sol duvar
    scale: { x: 0.9, y: 0.9, z: 0.9 },
    rotation: { x: 0, y: 0, z: 0 }, // Odanın içine baksın (+X yönü)
  },
  // Elektrik Panosu - Arka köşe (sağ duvar, arka taraf)
  electricalPanel: {
    file: "electrical_panel.glb",
    position: { x: 2.4, y: 1.2, z: -1.8 }, // Sağ duvar, arka köşe
    scale: { x: 0.9, y: 0.9, z: 0.9 },
    rotation: { x: 0, y: -Math.PI / 2, z: 0 }, // Sola baksın (odanın içine)
  },
  // Ofis Sandalyesi
  chair: {
    file: "office_chair.glb",
    position: { x: 0, y: 0, z: -1 },
    scale: { x: 0.8, y: 0.8, z: 0.8 },
    rotation: { x: 0, y: Math.PI, z: 0 },
  },
  // Misafir Sandalyesi 1 (Sağ Duvar - Orta)
  guestChair1: {
    file: "chair.glb",
    position: { x: 2.1, y: 0, z: -0.2 },
    scale: { x: 0.8, y: 0.8, z: 0.8 },
    rotation: { x: 0, y: -Math.PI / 2, z: 0 }, // Sola bakıyor
  },
  // Misafir Sandalyesi 2 (Sağ Duvar - Arka Taraf)
  guestChair2: {
    file: "chair.glb",
    position: { x: 2.1, y: 0, z: -0.8 },
    scale: { x: 0.8, y: 0.8, z: 0.8 },
    rotation: { x: 0, y: -Math.PI / 2, z: 0 }, // Sola bakıyor
  },
  // Saksı Bitkisi (Sol Arka Köşe)
  plant: {
    file: "majesty_palm_plant.glb",
    position: { x: -2.0, y: 0, z: -2.0 }, // Sol arka köşe - duvardan uzaklaştırıldı
    scale: { x: 1.2, y: 1.2, z: 1.2 }, // Daha sade bir boyut
    rotation: { x: 0, y: 0, z: 0 },
  },
  // Yangın Dolabı (Su sistemi / Hortum Dolabı) - Kod ile oluşturulacak
};

// Yüklenen modelleri saklayacak obje
const loadedModels = {};
let modelsLoaded = false;

// Model yükleme fonksiyonu - Promise tabanlı
function loadModel(modelKey) {
  return new Promise((resolve, reject) => {
    const config = REALISTIC_MODELS[modelKey];
    if (!config) {
      reject(new Error(`Model config not found: ${modelKey}`));
      return;
    }

    loader.load(
      config.file,
      (gltf) => {
        const model = gltf.scene;
        model.position.set(
          config.position.x,
          config.position.y,
          config.position.z
        );
        model.scale.set(config.scale.x, config.scale.y, config.scale.z);
        model.rotation.set(
          config.rotation.x,
          config.rotation.y,
          config.rotation.z
        );

        // Gölge ayarları
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        loadedModels[modelKey] = model;
        console.log(`✓ Model yüklendi: ${modelKey}`);
        resolve(model);
      },
      (progress) => {
        // Yükleme ilerleme
      },
      (error) => {
        console.warn(
          `⚠ Model yüklenemedi: ${modelKey} - Fallback kullanılacak`
        );
        resolve(null); // Hata durumunda null döndür, reject yapma
      }
    );
  });
}

// Tüm modelleri yükle
async function loadAllRealisticModels() {
  console.log("📦 Gerçekçi modeller yükleniyor...");

  const modelKeys = Object.keys(REALISTIC_MODELS);
  const loadPromises = modelKeys.map((key) => loadModel(key));

  await Promise.all(loadPromises);

  modelsLoaded = true;
  console.log("✅ Model yükleme tamamlandı!");

  return loadedModels;
}

let fireEffect, smokeEffect, feEffect;
let velocityRotation = new THREE.Vector3();
let FEAnimations;

let fireEnable = false; // Yangın başlangıçta kapalı
let smokeEnable = false;
let feEnable = false;
let alarmActive = false;
let fireIntensity = 1.0; // Yangın şiddeti (0-1)
let fireStage = "none"; // 'none', 'beginning', 'developed', 'extinguished'
let electricityOn = true; // Elektrik durumu
let selectedExtinguisher = null; // 'ABC', 'CO2', 'water'

// Zamanlama ve puanlama
let timerStarted = false;
let alarmResponseTime = 0;
let startTime = 0;
let userScore = 0;
let decisionLog = [];

// Senaryo bitti mi (başarı veya başarısızlık)?
let scenarioEnded = false;

// Yangın söndürme mesafesi ve zamanlayıcı
let nearFireStartTime = 0;
let isNearFire = false;
const requiredDistance = 2.5; // Alevin yakınında sayılacak mesafe (metre)
const requiredTime = 3000; // Yakında durma süresi (3 saniye - milisaniye)

// Parçacık yoğunluğu (performans için düşürüldü)
const fireRateValue = 18;
const smokeRateValue = 6;
const feRateValue = 140; // 1000'den düşürüldü - FPS optimizasyonu

let fireRate = 0;
let smokeRate = 0;
let feRate = feRateValue;

const cubeGeometry = new THREE.BoxGeometry();
const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });

// Fire Particles - Masanın altında, uzatma kablosundan başlıyor
const fireSpawn = new THREE.Mesh(cubeGeometry, cubeMaterial);
fireSpawn.position.set(0.7, 0.25, -1.5); // Masanın altında - heater pozisyonu
fireSpawn.scale.set(0.1, 0.1, 0.1);

const fireSpeed = 0.5;
const fireRotationSpeed = 10;
const fireVelocity = new THREE.Vector3(0, 0.5, 0); // Yukarı doğru - masaya yayılıyor

// Smoke Particles
const smokeSpawn = new THREE.Mesh(cubeGeometry, cubeMaterial);
smokeSpawn.position.set(0.7, 0.5, -1.5); // Ateşin üzerinde - masanın altında
smokeSpawn.scale.set(0.1, 0.1, 0.1);

// İkinci yangın kaynağı - bilgisayar (yangın büyüdüğünde)
let computerFireSpawn = new THREE.Mesh(cubeGeometry, cubeMaterial);
computerFireSpawn.position.set(0, 1.1, -1.8); // Monitör pozisyonu - masanın üzerinde
computerFireSpawn.scale.set(0.1, 0.1, 0.1);
computerFireSpawn.visible = false;

let computerFireEffect = null;
let computerFireActive = false;

const smokeSpeed = 0.5;
const smokeRotationSpeed = 10;
const smokeVelocity = new THREE.Vector3(0, 0.3, 0);

// Fire Extinguisher Particles
const feSpawn = new THREE.Mesh(cubeGeometry, cubeMaterial);
feSpawn.position.set(0.2, 0, 0);
feSpawn.scale.set(0.1, 0.1, 0.1);

const feSpeed = 0.5;
const feRotationSpeed = 10;
const feVelocity = new THREE.Vector3(0, 1, 0);
const FeRotation = new THREE.Vector3(0.6, 0, 0);

let feRoot = [];

// -------------------- GUI --------------------

const guiObject = {
  fireBoolean: true, // Yangın aktif olduğunda göster
  smokeBoolean: true, // Duman aktif olduğunda göster
  feBoolean: false, // Yangın söndürücü başlangıçta kapalı
  pauseBoolean: false,
  value1: 1,
  value2: 1,
  value3: 1.55, // Sahne parlaklığı (gölge/env kapalıyken daha aydınlık)
  value4: 0.05,
  color: { r: 0.01, g: 0.01, b: 0.01 },
};

addGUI();

initApp();

async function initApp() {
  await init();
  createProceduralHands();
  createFireHitbox();
  animate();
}

async function init() {
  // ------------------- Scene Setup -----------------------

  const container = document.createElement("div");
  document.body.appendChild(container);

  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );
  camera.position.set(0, 1.6, 2.0); // Oda içinde, kapının biraz önünde başla

  // Ses sistemini başlat
  initAudio();

  scene = new THREE.Scene();

  // -------------------- Particles --------------------

  fireEffect = getParticleSystem({
    camera,
    emitter: fireSpawn,
    parent: scene,
    rate: fireRate,
    texture: "./assets/img/fire.png",
    radius: 0.15, // Daha dar alan - daha az parçacık ekranı kaplar
    maxLife: 1.4, // Daha kısa yaşam süresi
    maxSize: 3.5, // Biraz daha küçük partiküller
    maxVelocity: fireVelocity,
    colorA: new THREE.Color(0xffff00), // Sarı
    colorB: new THREE.Color(0xff4400), // Turuncu-kırmızı
    alphaMax: 1.0,
  });

  smokeEffect = getParticleSystem({
    camera,
    emitter: smokeSpawn,
    parent: scene,
    rate: smokeRate,
    texture: "./assets/img/smoke.png",
    radius: 0.18, // Daha dar duman alanı
    maxLife: 2.5, // Daha kısa yaşam süresi
    maxSize: 4, // Daha küçük duman partikülleri
    maxVelocity: smokeVelocity,
    colorA: new THREE.Color(0x333333), // Koyu gri
    colorB: new THREE.Color(0x999999), // Açık gri
    alphaMax: 0.8,
  });

  feEffect = getParticleSystem({
    camera,
    emitter: feSpawn,
    parent: scene,
    rate: feRate,
    texture: "./assets/img/smoke.png",
    radius: 0.05,
    maxLife: 0.8,
    maxSize: 3, // Daha büyük - yakından görünsün
    maxVelocity: feVelocity,
    colorA: new THREE.Color(0xffffff),
    colorB: new THREE.Color(0xcccccc),
    alphaMax: 0.8,
  });

  // Bilgisayar yangın efekti (yangın büyüdüğünde)
  computerFireEffect = getParticleSystem({
    camera,
    emitter: computerFireSpawn,
    parent: scene,
    rate: 0, // Başlangıçta kapalı
    texture: "./assets/img/fire.png",
    radius: 0.11,
    maxLife: 1.0,
    maxSize: 1.4,
    maxVelocity: new THREE.Vector3(0, 0.3, 0),
    colorA: new THREE.Color(0xffff00), // Sarı
    colorB: new THREE.Color(0xff4400), // Turuncu-kırmızı
    alphaMax: 1.0,
  });

  // -------------------- Oda Oluştur --------------------

  await createRoom();

  // -------------------- Import Assets --------------------

  // FE - Yangın söndürücü pozisyonu
  loader.load(fileFE, async function (gltf) {
    modelFE = gltf.scene;
    // modelFE.scale.set( .1,.1,.1 );
    // First person view için yangın söndürücüyü kameraya bağla
    // Ekranın sağ alt köşesinde görünecek şekilde
    modelFE.position.set(0.35, -0.35, -0.5); // Kameraya göre: sağda, aşağıda, önde
    modelFE.rotation.set(0.1, Math.PI, 0); // Boruyu ileriye çevir (180 derece döndür)
    modelFE.scale.set(0.7, 0.7, 0.7); // Biraz küçült (kameraya çok yakın)

    modelFE.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false; // FPS view'da gölge istemeyiz
        child.receiveShadow = false;
      }
      if (child.name === "Fire_Extinguisher_Base") {
        feRoot[0] = child;
        console.log("feRoot[0] : ", feRoot[0]);
      }
      if (child.name === "FE_Origin") {
        feRoot[1] = child;
        // FPS view için rotasyonu ayarla - boruyu ileriye çevir
        feRoot[1].rotation.set(FeRotation.x, FeRotation.y, FeRotation.z);
        console.log("feRoot[1] : ", feRoot[1]);
      }
    });

    await renderer.compileAsync(modelFE, camera, scene);

    mixerFE = new AnimationMixer(modelFE);
    mixerFE.loop = false;
    FEAnimations = gltf.animations;

    // Yangın söndürücüyü kameraya ekle (FPS view)
    camera.add(modelFE);
    modelFE.visible = false; // Başlangıçta gizli (tüp alınana kadar)
    scene.add(camera); // Kamerayı da sahneye ekle
    console.log("modelFE FPS modunda kameraya eklendi");
    console.log(gltf.animations);
    console.log("mixerFE : ", mixerFE);
  });

  // Circle - KALDIRILDI (zemindeki siyah alan istenmiyor)
  // loader.load(fileBase, async function (gltf) {
  //   modelCircle = gltf.scene;
  //   modelCircle.traverse((child) => {
  //     if (child.isMesh) {
  //       child.castShadow = false;
  //       child.receiveShadow = true;
  //       child.material.renderOrder = 0;
  //       child.material.depthWrite = true;
  //       child.material.transparent = false;
  //       child.material.color = new THREE.Color(
  //         guiObject.color.r,
  //         guiObject.color.g,
  //         guiObject.color.b
  //       );
  //       baseCircle = child;
  //     }
  //   });
  //   await renderer.compileAsync(modelCircle, camera, scene);
  //   scene.add(modelCircle);
  // });

  hdriLoader.load("Env.hdr", function (texture) {
    if (!ENV_REFLECTION_ENABLED) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
  });
  if (!ENV_REFLECTION_ENABLED) scene.environment = null;

  // Oda için basit bir arka plan rengi
  scene.background = new THREE.Color(0x87ceeb); // Açık mavi gökyüzü rengi
  scene.fog = new THREE.Fog(0x87ceeb, 8, 20); // Hava perspektifi için sis

  // ------------------- Render Starts --------------------------------

  renderer = new THREE.WebGLRenderer({ antialias: antialiasing });
  // Yüksek DPI ekranlarda FPS'i korumak için piksel oranını sınırla
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = toneMapping;
  renderer.toneMappingExposure = 1;
  container.appendChild(renderer.domElement);

  // ---------------------------- Mouse İnteraction --------------------------------

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onMouseClick(event) {
    // Mouse click artık sadece pointer lock için kullanılıyor
    // Etkileşimler 'E' tuşu ile yapılıyor
  }

  // Tıklama ile kilitleme mantığı - Sadece UI interaksiyonu yoksa ve oyun başladıysa
  // Sadece senaryo başladıysa (timerStarted true ise) kilitle
  document.addEventListener("click", function (event) {
    // Kontrol ekranı açıksa kilitleme yapma
    const controlsIntro = document.getElementById("controls-intro");
    if (controlsIntro && controlsIntro.style.display !== "none") {
      return;
    }

    // Senaryo başlamadıysa kilitleme yapma
    if (!timerStarted) return;

    // Eğer bir UI elementine tıklanmadıysa ve kontroller kilitli değilse kilitle
    if (!controls.isLocked && event.target.tagName !== "BUTTON") {
      controls.lock();
    }
  });

  // ---------------------------- controls --------------------------------

  controls = new PointerLockControls(camera, document.body);

  controls.addEventListener('lock', function () {
    isLocked = true;
    // İsteğe bağlı: UI elementlerini gizle veya "Oyun Aktif" mesajı göster
  });

  controls.addEventListener('unlock', function () {
    isLocked = false;
    // İsteğe bağlı: Duraklatma menüsü göster
  });

  // OrbitControls ayarları kaldırıldı

  // FPS hareketi için klavye dinleyicileri
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // ---------------------------- scene --------------------------------

  window.addEventListener("resize", onWindowResize);

  // Aydınlatma Sistemi (gölge/env kapalıyken ortamı aydınlatmak için güçlendirildi)

  // Normal ofis aydınlatması (elektrik varken)
  window.mainLights = new THREE.Group();

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
  ambientLight.name = "mainAmbient";
  window.mainLights.add(ambientLight);

  // Gökyüzü/zemin dolgu ışığı (env map yokken eşyaları aydınlatır)
  const hemiLight = new THREE.HemisphereLight(0xe8f4fc, 0x8b7355, 0.55);
  hemiLight.name = "mainHemisphere";
  window.mainLights.add(hemiLight);

  const ceilingLight1 = new THREE.PointLight(0xffffee, 2.2, 10);
  ceilingLight1.position.set(-1, 2.8, -1);
  ceilingLight1.castShadow = true;
  window.mainLights.add(ceilingLight1);

  const ceilingLight2 = new THREE.PointLight(0xffffee, 2.2, 10);
  ceilingLight2.position.set(1, 2.8, 1);
  ceilingLight2.castShadow = true;
  window.mainLights.add(ceilingLight2);

  const fillDir = new THREE.DirectionalLight(0xffffff, 0.85);
  fillDir.position.set(2, 4, 2);
  fillDir.name = "mainFillDir";
  window.mainLights.add(fillDir);

  scene.add(window.mainLights);

  // Acil Durum Aydınlatması (sadece elektrik kesilince)
  window.emergencyLights = new THREE.Group();

  const emergencyAmbient = new THREE.AmbientLight(0xff4444, 0.25);
  emergencyAmbient.name = "emergencyAmbient";
  window.emergencyLights.add(emergencyAmbient);

  const emergencyFill = new THREE.AmbientLight(0xffffff, 0.6);
  emergencyFill.name = "emergencyFill";
  window.emergencyLights.add(emergencyFill);

  // Acil durum lambaları (kırmızı)
  const emergencyPositions = [
    [-2, 2.9, -2],
    [2, 2.9, -2],
    [-2, 2.9, 2],
    [2, 2.9, 2],
  ];

  emergencyPositions.forEach((pos, index) => {
    const emergencyLight = new THREE.PointLight(0xff0000, 1.1, 6);
    emergencyLight.position.set(pos[0], pos[1], pos[2]);
    emergencyLight.name = `emergency${index}`;
    window.emergencyLights.add(emergencyLight);

    // Görsel lamba kutusu
    const lampGeometry = new THREE.BoxGeometry(0.15, 0.08, 0.15);
    const lampMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.5,
    });
    const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
    lamp.position.copy(emergencyLight.position);
    room.add(lamp);
  });

  window.emergencyLights.visible = false; // Başlangıçta kapalı
  scene.add(window.emergencyLights);

  // --------------------------------- post --------------------------------

  // Gölge haritaları (masa/bilgisayar bölgesinde performansı düşürüyor)
  renderer.shadowMap.enabled = SHADOWS_ENABLED;
  if (SHADOWS_ENABLED) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Set up post-processing
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(1); // ensure pixel ratio is always 1 for performance reasons

  // Create and add render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Create and add bloom pass
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.05,
    0.7,
    0.4
  );
  composer.addPass(bloomPass);

  if (AmbientOcclusion) {
    const ssaoPass = new SSAOPass(scene, camera);
    ssaoPass.kernelRadius = 0.01; // Adjust for effect strength
    ssaoPass.minDistance = 0.0001; // Minimum distance for AO
    ssaoPass.maxDistance = 0.1; // Maximum distance for AO
    composer.addPass(ssaoPass);
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);

  composer.setSize(window.innerWidth, window.innerHeight); // Update composer size

  render();
}

function playFeAnimations() {
  FEAnimations.forEach((clip3) => {
    console.log("clip3: ", clip3);
    clip3.loop = false;
    mixerFE.clipAction(clip3).play();
  });
}

function stopFeAnimations() {
  FEAnimations.forEach((clip3) => {
    console.log("clip3: ", clip3);
    clip3.loop = false;
    mixerFE.clipAction(clip3).stop();
  });
}

// ----------------- Oda Fonksiyonu ------------------------

async function createRoom() {
  room = new THREE.Group();

  const roomSize = 5;
  const wallHeight = 3;
  const wallThickness = 0.1;

  // Malzemeler
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f5f0,
    roughness: 0.9,
    metalness: 0.05,
  });

  // Gerçekçi ahşap zemin dokusu için malzeme
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b6914,
    roughness: 0.8,
    metalness: 0.05,
  });

  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.95,
    metalness: 0.02,
  });

  // Zemin
  const floorGeometry = new THREE.BoxGeometry(
    roomSize,
    wallThickness,
    roomSize
  );
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.position.y = -wallThickness / 2;
  floor.receiveShadow = true;
  room.add(floor);

  // Tavan
  const ceilingGeometry = new THREE.BoxGeometry(
    roomSize,
    wallThickness,
    roomSize
  );
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.y = wallHeight;
  ceiling.receiveShadow = true;
  room.add(ceiling);

  // Arka duvar
  const backWallGeometry = new THREE.BoxGeometry(
    roomSize,
    wallHeight,
    wallThickness
  );
  const backWall = new THREE.Mesh(backWallGeometry, wallMaterial);
  backWall.position.set(0, wallHeight / 2, -roomSize / 2);
  backWall.receiveShadow = true;
  backWall.castShadow = true;
  room.add(backWall);

  // Sol duvar
  const leftWallGeometry = new THREE.BoxGeometry(
    wallThickness,
    wallHeight,
    roomSize
  );
  const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
  leftWall.position.set(-roomSize / 2, wallHeight / 2, 0);
  leftWall.receiveShadow = true;
  leftWall.castShadow = true;
  room.add(leftWall);

  // Sağ duvar
  const rightWallGeometry = new THREE.BoxGeometry(
    wallThickness,
    wallHeight,
    roomSize
  );
  const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial);
  rightWall.position.set(roomSize / 2, wallHeight / 2, 0);
  rightWall.receiveShadow = true;
  rightWall.castShadow = true;
  room.add(rightWall);

  // Ön Duvar (Kapılı)
  // Kapı boşluğu: x= -0.5 ile 0.5 arası (1m genişlik), Yükseklik 2.2m

  // Sol Parça (İçeriden bakınca sağ, x > 0.5)
  const frontRightGeo = new THREE.BoxGeometry(2.0, wallHeight, wallThickness);
  const frontRight = new THREE.Mesh(frontRightGeo, wallMaterial);
  frontRight.position.set(1.5, wallHeight / 2, roomSize / 2); // (0.5 + 2.5)/2 = 1.5
  frontRight.castShadow = true;
  frontRight.receiveShadow = true;
  room.add(frontRight);

  // Sağ Parça (İçeriden bakınca sol, x < -0.5)
  const frontLeftGeo = new THREE.BoxGeometry(2.0, wallHeight, wallThickness);
  const frontLeft = new THREE.Mesh(frontLeftGeo, wallMaterial);
  frontLeft.position.set(-1.5, wallHeight / 2, roomSize / 2);
  frontLeft.castShadow = true;
  frontLeft.receiveShadow = true;
  room.add(frontLeft);

  // Üst Parça (Kapı üstü)
  const doorHeight = 2.2;
  const frontTopGeo = new THREE.BoxGeometry(1.0, wallHeight - doorHeight, wallThickness);
  const frontTop = new THREE.Mesh(frontTopGeo, wallMaterial);
  frontTop.position.set(0, doorHeight + (wallHeight - doorHeight) / 2, roomSize / 2);
  frontTop.castShadow = true;
  frontTop.receiveShadow = true;
  room.add(frontTop);

  // KAPI
  const doorWidth = 1.0;
  const doorThick = 0.05;
  const doorGeo = new THREE.BoxGeometry(doorWidth, doorHeight, doorThick);
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x442200, roughness: 0.6 }); // Ahşap kapı
  const doorMesh = new THREE.Mesh(doorGeo, doorMat);

  // Pivot noktası için grup (Menteşe solda olsun)
  const doorGroup = new THREE.Group();
  doorGroup.position.set(-0.5, doorHeight / 2, roomSize / 2); // Menteşe noktası

  // Mesh'i gruba göre konumlandır (Grup merkezinden sağa doğru uzayacak)
  doorMesh.position.set(doorWidth / 2, 0, 0);

  doorMesh.name = "Door"; // Raycaster için isim
  doorGroup.add(doorMesh);

  // Kapı kolu
  const handleGeo = new THREE.SphereGeometry(0.05);
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 });
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.set(doorWidth - 0.1, 0, 0.05); // Kapının ucunda (Dış)
  handle.name = "Door";
  doorGroup.add(handle);

  // İç Kapı Kolu
  const handleInside = new THREE.Mesh(handleGeo, handleMat);
  handleInside.position.set(doorWidth - 0.1, 0, -0.05); // Kapının ucunda (İç)
  handleInside.name = "Door";
  doorGroup.add(handleInside);

  doorGroup.name = "DoorGroup";
  room.add(doorGroup);
  window.doorGroup = doorGroup;

  // Acil çıkış tabelası (GLB): Kapının tam üstünde, odanın içinde (duvara sabit)
  loader.load(
    "exit_box.glb",
    (gltf) => {
      const exitSign = gltf.scene;

      exitSign.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Konum: kapı boşluğunun tam üstü, ön duvarın iç yüzeyi
      // Kapı üstüne daha yakın ve biraz daha büyük
      exitSign.position.set(
        0,
        doorHeight + 0.15,
        roomSize / 2 - wallThickness / 2 - 0.01
      );

      // Ölçek: biraz daha büyük
      exitSign.scale.set(0.65, 0.65, 0.65);

      // Duvara paralel olsun (90°)
      exitSign.rotation.y = Math.PI / 2;

      room.add(exitSign);
    },
    undefined,
    (error) => {
      console.warn("⚠ exit_box.glb yüklenemedi:", error);
    }
  );

  // Dış Zemin (Balkon/Koridor)
  const outFloorGeo = new THREE.BoxGeometry(roomSize, wallThickness, 4.0);
  const outFloorMat = new THREE.MeshStandardMaterial({ color: 0x333333 }); // Beton zemin
  const outFloor = new THREE.Mesh(outFloorGeo, outFloorMat);
  outFloor.position.set(0, -wallThickness / 2, 4.5); // 2.5 + 2.0 = 4.5
  outFloor.receiveShadow = true;
  room.add(outFloor);

  // Acil Çıkış Takip Yolu (Gelişmiş - L Şekli, Kusursuz Köşe)
  const exitPathGroup = new THREE.Group();
  room.add(exitPathGroup);

  // Materyaller
  const pathMat = new THREE.MeshBasicMaterial({ color: 0x009900, side: THREE.DoubleSide }); // Yeşil Yol
  const borderMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide }); // Sarı Şeritler
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide }); // Sarı Oklar

  const pathY = 0.02; // Zemin üstü

  // Koordinat Limitleri:
  // Z Başlangıç: 2.5 (Kapı)
  // Z Dönüş Merkezi: 5.0 (Koridor Ortası)
  // X Bitiş: -2.2 (Sola gidiş, zemin sınırı -2.5 olduğu için güvenli pay bırakıldı)

  // 1. DİKEY BÖLÜM (Kapıdan İleri) - YEŞİL
  // Z: 2.5 -> 5.4 (Dönüşün dış kenarına kadar)
  const vGreenGeo = new THREE.PlaneGeometry(0.8, 2.9);
  const vGreen = new THREE.Mesh(vGreenGeo, pathMat);
  vGreen.rotation.x = -Math.PI / 2;
  vGreen.position.set(0, pathY, 2.5 + 1.45); // Orta nokta: 3.95
  exitPathGroup.add(vGreen);

  // 2. YATAY BÖLÜM (Sola Dönüş) - YEŞİL
  // X: -0.4 (Dikey parçanın iç kenarı) -> -2.2
  const hGreenGeo = new THREE.PlaneGeometry(1.8, 0.8);
  const hGreen = new THREE.Mesh(hGreenGeo, pathMat);
  hGreen.rotation.x = -Math.PI / 2;
  hGreen.position.set(-1.3, pathY, 5.0); // Z=5.0 merkezli
  exitPathGroup.add(hGreen);

  // 3. DIŞ KENAR (Sağ -> Üst Sarı Şerit)
  // Dikey Sağ Border: Z 2.5 -> 5.45
  const borderRightGeo = new THREE.PlaneGeometry(0.1, 2.95);
  const borderRight = new THREE.Mesh(borderRightGeo, borderMat);
  borderRight.rotation.x = -Math.PI / 2;
  borderRight.position.set(0.45, pathY, 2.5 + 1.475);
  exitPathGroup.add(borderRight);

  // Yatay Üst Border: X 0.45 -> -2.2
  const borderTopGeo = new THREE.PlaneGeometry(2.65, 0.1);
  const borderTop = new THREE.Mesh(borderTopGeo, borderMat);
  borderTop.rotation.x = -Math.PI / 2;
  borderTop.position.set(-0.875, pathY, 5.45);
  exitPathGroup.add(borderTop);

  // 4. İÇ KENAR (Sol -> Alt Sarı Şerit)
  // Dikey Sol Border: Z 2.5 -> 4.55 (İç köşe hizası)
  const borderLeftGeo = new THREE.PlaneGeometry(0.1, 2.05);
  const borderLeft = new THREE.Mesh(borderLeftGeo, borderMat);
  borderLeft.rotation.x = -Math.PI / 2;
  borderLeft.position.set(-0.45, pathY, 2.5 + 1.025);
  exitPathGroup.add(borderLeft);

  // Yatay Alt Border: X -0.45 -> -2.2
  const borderBottomGeo = new THREE.PlaneGeometry(1.75, 0.1);
  const borderBottom = new THREE.Mesh(borderBottomGeo, borderMat);
  borderBottom.rotation.x = -Math.PI / 2;
  borderBottom.position.set(-1.325, pathY, 4.55);
  exitPathGroup.add(borderBottom);

  // KÖŞE KAPATMA (Sarı Kareler - Z-fighting önlemek için gerekirse)
  // Şu anki geometri overlap ile doğal kapanıyor.

  // --- OKLAR ---
  const arrowGeo = new THREE.CircleGeometry(0.3, 3); // Üçgen Ok

  // Ok 1: İleri
  const arrow1 = new THREE.Mesh(arrowGeo, arrowMat);
  arrow1.rotation.x = -Math.PI / 2;
  arrow1.rotation.z = -Math.PI / 2; // +Z yönü
  arrow1.position.set(0, pathY + 0.01, 3.5);
  exitPathGroup.add(arrow1);

  // Ok 2: Sola
  const arrow2 = new THREE.Mesh(arrowGeo, arrowMat);
  arrow2.rotation.x = -Math.PI / 2;
  arrow2.rotation.z = Math.PI; // -X yönü (Sol)
  arrow2.position.set(-1.5, pathY + 0.01, 5.0);
  exitPathGroup.add(arrow2);

  // ==================== GERÇEKÇİ MODELLER ====================
  // Önce modelleri yüklemeyi dene, başarısız olursa fallback kullan

  await loadAllRealisticModels();

  // -------------------- OFİS MASASI --------------------
  if (loadedModels.desk) {
    room.add(loadedModels.desk);
    console.log("✓ Gerçekçi masa modeli eklendi");
  } else {
    // Fallback: Basit geometri masa
    createFallbackDesk();
  }

  // -------------------- ALARM BUTONU --------------------
  if (loadedModels.alarmButton) {
    const alarmModel = loadedModels.alarmButton;
    alarmModel.name = "alarmBox";
    alarmModel.traverse((child) => {
      if (child.isMesh) {
        child.name = "alarmBox";
      }
    });
    room.add(alarmModel);
    console.log("✓ Gerçekçi alarm butonu eklendi");
  } else {
    // Fallback: Basit alarm butonu
    createFallbackAlarmButton();
  }

  // -------------------- ISITICI (HEATER) --------------------
  let heater;
  if (loadedModels.heater) {
    heater = loadedModels.heater;
    heater.name = "heater";
    heater.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone();
        child.material.metalness = 0.25;
        child.material.roughness = 0.55;
      }
    });
    room.add(heater);
    console.log("✓ Gerçekçi ısıtıcı eklendi");
  } else {
    // Fallback: Basit çöp kovası (Isıtıcı yerine)
    heater = createFallbackTrashCan();
    heater.name = "heater";
  }

  // Elektrik kablosu kaldırıldı - yangın kaynağı artık görsel olarak gösterilmiyor
  // Yangın efekti ısıtıcı/masa üzerinden başlayacak

  // -------------------- BİLGİSAYAR DONANIMI --------------------
  let monitor, screen, keyboard, computerMouse;

  if (loadedModels.monitor) {
    monitor = loadedModels.monitor;
    monitor.name = "monitor";
    room.add(monitor);
    console.log("✓ Gerçekçi monitör eklendi");
  } else {
    // Fallback: Basit monitör
    const monitorData = createFallbackMonitor();
    monitor = monitorData.monitor;
    screen = monitorData.screen;
  }

  if (loadedModels.keyboard) {
    keyboard = loadedModels.keyboard;
    keyboard.name = "keyboard";
    room.add(keyboard);
    console.log("✓ Gerçekçi klavye eklendi");
  } else if (!loadedModels.monitor) {
    // Fallback zaten oluşturuldu
  }

  if (loadedModels.mouse) {
    computerMouse = loadedModels.mouse;
    room.add(computerMouse);
    console.log("✓ Gerçekçi mouse eklendi");
  }

  // -------------------- OFİS SANDALYESİ --------------------
  if (loadedModels.chair) {
    room.add(loadedModels.chair);
    console.log("✓ Gerçekçi ofis sandalyesi eklendi");
  } else {
    // Fallback: Basit sandalye
    createFallbackChair();
  }

  // -------------------- MİSAFİR SANDALYELERİ --------------------
  if (loadedModels.guestChair1) {
    room.add(loadedModels.guestChair1);
    console.log("✓ Misafir sandalyesi 1 eklendi");
  }

  if (loadedModels.guestChair2) {
    room.add(loadedModels.guestChair2);
    console.log("✓ Misafir sandalyesi 2 eklendi");
  }

  // -------------------- BİTKİ --------------------
  if (loadedModels.plant) {
    room.add(loadedModels.plant);
    console.log("✓ Bitki eklendi");
  }

  // Bilgisayar referansını sakla (yangın yayılması için)
  window.computerEquipment = {
    monitor: monitor || loadedModels.monitor,
    screen: screen,
    keyboard: keyboard || loadedModels.keyboard,
    mouse: computerMouse || loadedModels.mouse,
  };

  // Yangın söndürücüler - 3 tip
  createExtinguishers();

  // Elektrik panosu
  if (loadedModels.electricalPanel) {
    room.add(loadedModels.electricalPanel);
    window.electricalPanel = loadedModels.electricalPanel;
    console.log("✓ Gerçekçi elektrik panosu eklendi");
  } else {
    createElectricalPanel();
  }

  // Yangın dolabı (Kod ile oluşturulmuş gerçekçi model)
  createFireHoseCabinet();

  // Yanan nesne etiketi
  window.burningObject = heater;

  scene.add(room);
}

// ==================== FALLBACK FONKSİYONLARI ====================
// Model yüklenemezse kullanılacak basit geometriler

function createFallbackDesk() {
  // Masa üstü
  const deskGeometry = new THREE.BoxGeometry(1.5, 0.05, 0.8);
  const deskMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c4033,
    roughness: 0.7,
    metalness: 0.1,
  });
  const desk = new THREE.Mesh(deskGeometry, deskMaterial);
  desk.position.set(0, 0.75, 0);
  desk.castShadow = true;
  desk.receiveShadow = true;
  room.add(desk);

  // Masa Bacakları
  const legGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.72, 12);
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.4,
    metalness: 0.6,
  });

  const positions = [
    [-0.68, 0.36, -0.35],
    [0.68, 0.36, -0.35],
    [-0.68, 0.36, 0.35],
    [0.68, 0.36, 0.35],
  ];

  positions.forEach((pos) => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(pos[0], pos[1], pos[2]);
    leg.castShadow = true;
    room.add(leg);
  });

  console.log("⚠ Fallback masa kullanıldı");
}

// Procedural Hands (Three.js Primitives)
function createProceduralHands() {
  handsGroup = new THREE.Group();

  const skinMaterial = new THREE.MeshStandardMaterial({
    color: 0xe0ac69, // Skin tone
    roughness: 0.6,
    metalness: 0.05
  });

  const createHand = (isRight) => {
    const handGroup = new THREE.Group();
    const side = isRight ? 1 : -1;

    // Arm (Forearm)
    const armGeo = new THREE.CylinderGeometry(0.04, 0.045, 0.5, 12);
    const arm = new THREE.Mesh(armGeo, skinMaterial);
    arm.rotation.x = Math.PI / 2 - 0.2;
    arm.position.set(0.25 * side, -0.35, -0.15);
    handGroup.add(arm);

    // Palm
    const palmGeo = new THREE.BoxGeometry(0.1, 0.03, 0.12);
    const palm = new THREE.Mesh(palmGeo, skinMaterial);
    palm.position.set(0.25 * side, -0.28, -0.42);
    palm.rotation.x = -0.1;
    handGroup.add(palm);

    // Fingers
    const fingerGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8);
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(fingerGeo, skinMaterial);
      finger.rotation.x = Math.PI / 2;
      finger.position.set(
        (0.25 * side) + (i * 0.025 - 0.0375) * side,
        -0.27,
        -0.49
      );
      handGroup.add(finger);
    }

    // Thumb
    const thumb = new THREE.Mesh(fingerGeo, skinMaterial);
    thumb.rotation.x = Math.PI / 2;
    thumb.rotation.y = side * 0.5;
    thumb.position.set(
      (0.25 * side) - (0.06 * side),
      -0.28,
      -0.44
    );
    handGroup.add(thumb);

    return handGroup;
  };

  handsGroup.add(createHand(false)); // Left
  handsGroup.add(createHand(true));  // Right

  camera.add(handsGroup);
}

function createFallbackAlarmButton() {
  // GİRİŞE YAKIN - Sol duvar (x=-2.4, z=1.8)
  const alarmX = -2.4;
  const alarmY = 1.4;
  const alarmZ = 1.8;

  // Alarm arka kutusu
  const alarmBackGeometry = new THREE.BoxGeometry(0.08, 0.35, 0.35); // Döndürüldü
  const alarmBackMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.2,
  });
  const alarmBack = new THREE.Mesh(alarmBackGeometry, alarmBackMaterial);
  alarmBack.position.set(alarmX, alarmY, alarmZ);
  alarmBack.castShadow = true;
  room.add(alarmBack);

  // Alarm butonu (kırmızı - basılabilir)
  const alarmButtonGeometry = new THREE.CylinderGeometry(0.1, 0.11, 0.06, 32);
  const alarmButtonMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.8,
  });
  const alarmButton = new THREE.Mesh(alarmButtonGeometry, alarmButtonMaterial);
  alarmButton.position.set(alarmX + 0.07, alarmY, alarmZ); // Duvardan dışarı
  alarmButton.rotation.z = Math.PI / 2; // Yatay - sağa baksın
  alarmButton.name = "alarmBox";
  alarmButton.castShadow = true;
  room.add(alarmButton);

  // Alarm kutu çerçevesi (kırmızı çizgi)
  const frameGeometry = new THREE.BoxGeometry(0.02, 0.37, 0.37); // Döndürüldü
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xcc0000,
    roughness: 0.4,
    metalness: 0.6,
  });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.set(alarmX + 0.02, alarmY, alarmZ);
  room.add(frame);

  // "ALARM" yazısı plakası
  const textGeometry = new THREE.BoxGeometry(0.02, 0.06, 0.3); // Döndürüldü
  const textMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0x440000,
    emissiveIntensity: 0.4,
  });
  const textPlate = new THREE.Mesh(textGeometry, textMaterial);
  textPlate.position.set(alarmX + 0.02, alarmY + 0.22, alarmZ);
  room.add(textPlate);

  console.log("⚠ Fallback alarm butonu kullanıldı");
}

function createFallbackTrashCan() {
  // Isıtıcı (Masa altında) - Yangın kaynağı, orijinal gri metal görünüm
  const trashCanGeometry = new THREE.CylinderGeometry(0.16, 0.19, 0.38, 20);
  const trashCanMaterial = new THREE.MeshStandardMaterial({
    color: 0x6e6e6e,
    roughness: 0.55,
    metalness: 0.35,
  });
  const trashCan = new THREE.Mesh(trashCanGeometry, trashCanMaterial);
  trashCan.position.set(0.35, 0.19, 0.15);
  trashCan.castShadow = true;
  trashCan.receiveShadow = true;
  trashCan.name = "trashcan";
  room.add(trashCan);

  // Isıtıcı kovası kenar bandı
  const rimGeometry = new THREE.TorusGeometry(0.17, 0.015, 8, 24);
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0x505050,
    roughness: 0.4,
    metalness: 0.6,
  });
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.position.set(0.35, 0.38, 0.15);
  rim.rotation.x = Math.PI / 2;
  room.add(rim);

  // Yangın spawn pozisyonunu güncelle - masanın altında
  fireSpawn.position.set(0.4, 0.25, -1.5);
  smokeSpawn.position.set(0.4, 0.5, -1.5);

  console.log("⚠ Fallback çöp kovası kullanıldı");
  return trashCan;
}

function createFallbackMonitor() {
  // Monitör
  const monitorGeometry = new THREE.BoxGeometry(0.55, 0.38, 0.04);
  const monitorMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.2,
    metalness: 0.7,
  });
  const monitor = new THREE.Mesh(monitorGeometry, monitorMaterial);
  monitor.position.set(0, 0.98, -0.18);
  monitor.rotation.x = -0.08;
  monitor.castShadow = true;
  monitor.receiveShadow = true;
  monitor.name = "monitor";
  room.add(monitor);

  // Monitör ekranı (mavi - açık)
  const screenGeometry = new THREE.BoxGeometry(0.5, 0.32, 0.01);
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a8cff,
    emissive: 0x0055aa,
    emissiveIntensity: 0.6,
    roughness: 0.05,
    metalness: 0.1,
  });
  const screen = new THREE.Mesh(screenGeometry, screenMaterial);
  screen.position.set(0, 0.98, -0.155);
  screen.rotation.x = -0.08;
  room.add(screen);

  // Monitör standı - boyun
  const neckGeometry = new THREE.BoxGeometry(0.06, 0.15, 0.06);
  const standMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.4,
    metalness: 0.6,
  });
  const neck = new THREE.Mesh(neckGeometry, standMaterial);
  neck.position.set(0, 0.855, -0.18);
  room.add(neck);

  // Monitör standı - taban
  const baseGeometry = new THREE.CylinderGeometry(0.12, 0.14, 0.02, 24);
  const base = new THREE.Mesh(baseGeometry, standMaterial);
  base.position.set(0, 0.785, -0.18);
  room.add(base);

  // Klavye
  const keyboardGeometry = new THREE.BoxGeometry(0.42, 0.015, 0.14);
  const keyboardMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.6,
    metalness: 0.3,
  });
  const keyboard = new THREE.Mesh(keyboardGeometry, keyboardMaterial);
  keyboard.position.set(0, 0.785, 0.12);
  keyboard.castShadow = true;
  keyboard.name = "keyboard";
  room.add(keyboard);

  // Mouse
  const mouseGeometry = new THREE.BoxGeometry(0.055, 0.025, 0.095);
  const mouseMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.4,
    metalness: 0.4,
  });
  const computerMouse = new THREE.Mesh(mouseGeometry, mouseMaterial);
  computerMouse.position.set(0.28, 0.79, 0.15);
  computerMouse.castShadow = true;
  room.add(computerMouse);

  console.log("⚠ Fallback monitör/klavye/mouse kullanıldı");

  return { monitor, screen, keyboard, mouse: computerMouse };
}

function createFallbackChair() {
  // Basit ofis sandalyesi
  const chairGroup = new THREE.Group();

  // Oturma yeri
  const seatGeometry = new THREE.BoxGeometry(0.45, 0.06, 0.45);
  const seatMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.8,
    metalness: 0.1,
  });
  const seat = new THREE.Mesh(seatGeometry, seatMaterial);
  seat.position.y = 0.45;
  chairGroup.add(seat);

  // Sırt dayama
  const backGeometry = new THREE.BoxGeometry(0.42, 0.5, 0.05);
  const back = new THREE.Mesh(backGeometry, seatMaterial);
  back.position.set(0, 0.73, -0.2);
  back.rotation.x = 0.1;
  chairGroup.add(back);

  // Merkez ayak
  const legGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.25, 12);
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.3,
    metalness: 0.8,
  });
  const centerLeg = new THREE.Mesh(legGeometry, legMaterial);
  centerLeg.position.y = 0.3;
  chairGroup.add(centerLeg);

  // 5 tekerlekli ayak
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const wheelLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.25, 8),
      legMaterial
    );
    wheelLeg.position.set(Math.cos(angle) * 0.18, 0.08, Math.sin(angle) * 0.18);
    wheelLeg.rotation.z = (Math.PI / 6) * (angle > Math.PI ? 1 : -1);
    chairGroup.add(wheelLeg);

    // Tekerlek
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
    );
    wheel.position.set(Math.cos(angle) * 0.25, 0.015, Math.sin(angle) * 0.25);
    wheel.rotation.z = Math.PI / 2;
    chairGroup.add(wheel);
  }

  chairGroup.position.set(0, 0, 0.9);
  chairGroup.rotation.y = Math.PI + 0.2;
  room.add(chairGroup);

  console.log("⚠ Fallback sandalye kullanıldı");
}

// Yangın Söndürücüler Oluştur - Gerçekçi modeller
function createExtinguishers() {
  // ABC Kuru Kimyevi Toz (Kırmızı) - Gerçekçi model
  loader.load(fileFE, function (gltf) {
    const abcModel = gltf.scene.clone();
    // Alarm butonu: x: -2.4, y: 1.4, z: 1.8
    // Duvara monte konumu
    abcModel.position.set(-2.35, 0.9, 1.6); // Alarmın biraz solu/altı
    abcModel.rotation.y = 0; // Duvara paralel/düz
    abcModel.scale.set(0.8, 0.8, 0.8);
    abcModel.name = "ABC";

    abcModel.traverse((child) => {
      const lowerName = child.name.toLowerCase();

      // El ve kol kısımlarını gizle
      if (
        lowerName.includes("hand") ||
        lowerName.includes("arm") ||
        lowerName.includes("finger") ||
        lowerName.includes("palm") ||
        lowerName.includes("wrist") ||
        lowerName.includes("glove") ||
        lowerName.includes("skin") ||
        lowerName.includes("human")
      ) {
        child.visible = false;
        return;
      }

      // Her child'a ABC ismini ver - raycaster için gerekli
      if (child.isMesh) {
        child.name = "ABC";
      } else {
        child.name = "ABC";
      }

      if (child.isMesh || child.isSkinnedMesh) {
        // Kırmızı renk - ABC tüpü (env kapalıyken de belirgin olsun)
        if (child.material) {
          child.material = child.material.clone();
          child.material.color = new THREE.Color(0xff0000);
          child.material.emissive = new THREE.Color(0x660000);
          child.material.emissiveIntensity = 0.35;
          child.material.metalness = 0.15;
          child.material.roughness = 0.5;
        }
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    room.add(abcModel);

    // Etiket kaldırıldı

    window.extinguishers = window.extinguishers || {};
    window.extinguishers.ABC = abcModel;

    console.log("ABC söndürücü yüklendi");
  });

  // CO2 Söndürücü (Siyah) - Gerçekçi model
  loader.load(fileFE, function (gltf) {
    const co2Model = gltf.scene.clone();
    // Alarm butonu: x: -2.4, y: 1.4, z: 1.8
    // Duvara monte konumu
    co2Model.position.set(-2.35, 0.9, 2.0); // Alarmın biraz sağı/altı
    co2Model.rotation.y = 0; // Duvara paralel/düz
    co2Model.scale.set(0.8, 0.8, 0.8);
    co2Model.name = "CO2";

    co2Model.traverse((child) => {
      const lowerName = child.name.toLowerCase();

      // El ve kol kısımlarını gizle
      if (
        lowerName.includes("hand") ||
        lowerName.includes("arm") ||
        lowerName.includes("finger") ||
        lowerName.includes("palm") ||
        lowerName.includes("wrist") ||
        lowerName.includes("glove") ||
        lowerName.includes("skin") ||
        lowerName.includes("human")
      ) {
        child.visible = false;
        return;
      }

      // Her child'a CO2 ismini ver - raycaster için gerekli
      if (child.isMesh) {
        child.name = "CO2";
      } else {
        child.name = "CO2";
      }

      if (child.isMesh || child.isSkinnedMesh) {
        // Siyah renk - CO2 tüpü (env kapalıyken de net siyah kalsın)
        if (child.material) {
          child.material = child.material.clone();
          child.material.color = new THREE.Color(0x1a1a1a);
          child.material.emissive = new THREE.Color(0x000000);
          child.material.emissiveIntensity = 0;
          child.material.metalness = 0.7;
          child.material.roughness = 0.4;
        }
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    room.add(co2Model);

    // Etiket kaldırıldı

    window.extinguishers = window.extinguishers || {};
    window.extinguishers.CO2 = co2Model;

    console.log("CO2 söndürücü yüklendi");
  });

  // Yangın Dolabı (Su sistemi) - GLB modeli createRoom() içinde yükleniyor
  // Fallback kaldırıldı - sadece fire_hose_cabinet.glb kullanılıyor
}

// Elektrik Panosu - Gerçekçi
function createElectricalPanel() {
  // ARKA KÖŞE - Sağ duvar (x=2.4, z=-1.8)
  const panelX = 2.4;
  const panelY = 1.2;
  const panelZ = -1.8;

  // Ana pano kutusu (gri metal)
  const panelGeometry = new THREE.BoxGeometry(0.12, 0.7, 0.5); // Döndürüldü
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x666666,
    roughness: 0.5,
    metalness: 0.6,
  });
  const panel = new THREE.Mesh(panelGeometry, panelMaterial);
  panel.position.set(panelX, panelY, panelZ);
  panel.name = "electricalPanel";
  panel.castShadow = true;
  room.add(panel);

  // Pano kapağı (açık gri)
  const doorGeometry = new THREE.BoxGeometry(0.03, 0.65, 0.45); // Döndürüldü
  const doorMaterial = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    roughness: 0.4,
    metalness: 0.5,
  });
  const door = new THREE.Mesh(doorGeometry, doorMaterial);
  door.position.set(panelX - 0.06, panelY, panelZ);
  room.add(door);

  // Tehlike işareti (sarı-siyah)
  const warningGeometry = new THREE.BoxGeometry(0.01, 0.15, 0.15); // Döndürüldü
  const warningMaterial = new THREE.MeshStandardMaterial({
    color: 0xffdd00,
    emissive: 0x443300,
    emissiveIntensity: 0.4,
    roughness: 0.3,
  });
  const warning = new THREE.Mesh(warningGeometry, warningMaterial);
  warning.position.set(panelX - 0.08, panelY + 0.15, panelZ);
  room.add(warning);

  // Kırmızı çizgi (tehlike)
  const lineGeometry = new THREE.BoxGeometry(0.01, 0.02, 0.4); // Döndürüldü
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0x660000,
    emissiveIntensity: 0.3,
  });
  const line = new THREE.Mesh(lineGeometry, lineMaterial);
  line.position.set(panelX - 0.08, panelY - 0.15, panelZ);
  room.add(line);

  // "ELEKTRİK PANOSU" yazı plakası
  const labelGeometry = new THREE.BoxGeometry(0.01, 0.06, 0.35); // Döndürüldü
  const labelMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    emissive: 0x111111,
    emissiveIntensity: 0.2,
  });
  const label = new THREE.Mesh(labelGeometry, labelMaterial);
  label.position.set(panelX - 0.08, panelY + 0.35, panelZ);
  room.add(label);

  // Kilit/mandal
  const lockGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8);
  const lockMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    metalness: 0.9,
    roughness: 0.2,
  });
  const lock = new THREE.Mesh(lockGeometry, lockMaterial);
  lock.position.set(panelX - 0.08, panelY, panelZ + 0.15);
  lock.rotation.x = Math.PI / 2;
  room.add(lock);

  window.electricalPanel = panel;
}

// Yangın Dolabı - Gerçekçi (Kod ile)
function createFireHoseCabinet() {
  const x = 2.4; // Sağ duvarın yüzeyi
  const y = 1.0;
  const z = 1.5;

  const cabinetGroup = new THREE.Group();
  cabinetGroup.position.set(x, y, z);
  cabinetGroup.rotation.y = -Math.PI / 2; // Odaya bakacak
  cabinetGroup.name = "WATER";

  // 1. Ana Kasa (Kırmızı) - İçi boş kutu yapısı
  const cabinetMat = new THREE.MeshStandardMaterial({
    color: 0xaa0000, // Koyu kırmızı
    roughness: 0.3,
    metalness: 0.6
  });

  // Arka Panel
  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.02), cabinetMat);
  backPanel.position.z = -0.09;
  backPanel.name = "WATER";
  cabinetGroup.add(backPanel);

  // Üst Panel
  const topPanel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.2), cabinetMat);
  topPanel.position.set(0, 0.39, 0);
  topPanel.name = "WATER";
  cabinetGroup.add(topPanel);

  // Alt Panel
  const bottomPanel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.2), cabinetMat);
  bottomPanel.position.set(0, -0.39, 0);
  bottomPanel.name = "WATER";
  cabinetGroup.add(bottomPanel);

  // Sol Panel
  const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.8, 0.2), cabinetMat);
  leftPanel.position.set(-0.39, 0, 0);
  leftPanel.name = "WATER";
  cabinetGroup.add(leftPanel);

  // Sağ Panel
  const rightPanel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.8, 0.2), cabinetMat);
  rightPanel.position.set(0.39, 0, 0);
  rightPanel.name = "WATER";
  cabinetGroup.add(rightPanel);

  // 2. Cam Kapak (Yarı saydam)
  const glassGeom = new THREE.BoxGeometry(0.7, 0.7, 0.02);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.3,
    roughness: 0.1,
    metalness: 0.9,
    transmission: 0.5,
    thickness: 0.02
  });
  const glass = new THREE.Mesh(glassGeom, glassMat);
  glass.position.z = 0.11; // Hafif önde
  glass.name = "WATER";
  cabinetGroup.add(glass);

  // 3. Çerçeve (Kapak çerçevesi)
  // Basitlik için kenarlara ek parçalar
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x880000 });
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.04, 0.04), frameMat);
  frameTop.position.set(0, 0.37, 0.11);
  cabinetGroup.add(frameTop);

  const frameBot = frameTop.clone();
  frameBot.position.set(0, -0.37, 0.11);
  cabinetGroup.add(frameBot);

  const frameSide = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.74, 0.04), frameMat);
  frameSide.position.set(0.37, 0, 0.11);
  cabinetGroup.add(frameSide);

  const frameSide2 = frameSide.clone();
  frameSide2.position.set(-0.37, 0, 0.11);
  cabinetGroup.add(frameSide2);

  // 4. Hortum Makarası (Gelişmiş Tasarım)
  const reelGroup = new THREE.Group();
  reelGroup.position.z = 0; // Merkeze yerleştir
  cabinetGroup.add(reelGroup);

  // Makara Göbeği
  const coreGeom = new THREE.CylinderGeometry(0.12, 0.12, 0.14, 32);
  const reelColorMat = new THREE.MeshStandardMaterial({
    color: 0xaa0000,
    roughness: 0.5,
    metalness: 0.2
  });
  const core = new THREE.Mesh(coreGeom, reelColorMat);
  core.rotation.x = Math.PI / 2;
  reelGroup.add(core);

  // Makara Yan Diskleri (Hortumu tutan kısımlar)
  const discGeom = new THREE.CylinderGeometry(0.32, 0.32, 0.01, 32);

  const discLeft = new THREE.Mesh(discGeom, reelColorMat);
  discLeft.rotation.x = Math.PI / 2;
  discLeft.position.z = -0.07;
  reelGroup.add(discLeft);

  const discRight = discLeft.clone();
  discRight.position.z = 0.07;
  reelGroup.add(discRight);

  // 5. Sarılı Hortum (Çoklu halka ile sarmal görünümü)
  const hoseMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a, // Koyu siyah lastik rengi
    roughness: 0.9,
    metalness: 0.1
  });

  // Hortum katmanları
  // 3 Katman üst üste sarılmış hortum
  for (let layer = 0; layer < 3; layer++) {
    const radius = 0.16 + (layer * 0.04); // Her katmanda çap artıyor
    const tubeRadius = 0.02;

    // Her katmanda yan yana 3 tur
    for (let i = -1; i <= 1; i++) {
      const torusGeom = new THREE.TorusGeometry(radius, tubeRadius, 8, 24);
      const loop = new THREE.Mesh(torusGeom, hoseMat);
      loop.position.z = i * 0.035; // Yan yana diz
      // Hafif rastgele rotasyon ver ki doğal dursun
      loop.rotation.z = Math.random() * Math.PI;
      reelGroup.add(loop);
    }
  }

  // 6. Nozul / Lans (Hortum ucu)
  const nozzleGroup = new THREE.Group();
  nozzleGroup.position.set(0.15, -0.25, 0.05); // Sağ alt köşeye sarkmış
  nozzleGroup.rotation.z = -Math.PI / 3;

  // Nozul gövdesi
  const nozzleBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.03, 0.15, 16),
    new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.3 }) // Altın/Pirinç rengi
  );
  nozzleGroup.add(nozzleBody);

  // Nozul ucu (Kırmızı vana kısmı)
  const nozzleTip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.02, 0.05, 16),
    new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.4 })
  );
  nozzleTip.position.y = 0.08;
  nozzleGroup.add(nozzleTip);

  reelGroup.add(nozzleGroup);


  // 6. (Kaldırıldı) Eski beyaz uyarı levhası yerine direkt "YANGIN DOLABI" yazısı kullanılacak

  // 7. "YANGIN DOLABI" yazısı (CanvasTexture ile)
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 128;
  const ctx = labelCanvas.getContext("2d");
  if (ctx) {
    // Arka plan
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, labelCanvas.width, labelCanvas.height);

    // Yazı
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 64px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("YANGIN DOLABI", labelCanvas.width / 2, labelCanvas.height / 2);
  }

  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.wrapS = THREE.ClampToEdgeWrapping;
  labelTexture.wrapT = THREE.ClampToEdgeWrapping;
  labelTexture.needsUpdate = true;

  const labelMat = new THREE.MeshBasicMaterial({
    map: labelTexture,
    transparent: true,
  });

  // Levhanın fiziksel boyutu (genişlik x yükseklik)
  const labelWidth = 0.6;
  const labelHeight = 0.14;
  const labelGeom = new THREE.PlaneGeometry(labelWidth, labelHeight);
  const labelMesh = new THREE.Mesh(labelGeom, labelMat);
  // Mevcut beyaz levhanın hemen önüne, üst kısmına yerleştir
  labelMesh.position.set(0, 0.25, 0.135);
  cabinetGroup.add(labelMesh);

  room.add(cabinetGroup);

  window.extinguishers = window.extinguishers || {};
  window.extinguishers.WATER = cabinetGroup;
  console.log("✓ Gerçekçi yangın dolabı kod ile oluşturuldu");
}

// ----------------- Yangın Kontrol Fonksiyonları ------------------------

function startFire() {
  if (!timerStarted) {
    timerStarted = true;
    startTime = Date.now();
  }

  fireEnable = true;
  smokeEnable = true;
  fireIntensity = 1.0;
  fireStage = "beginning";

  // Elektrik kesintisi - Kaçak akım rölesi devreye giriyor
  cutElectricity();

  decisionLog.push({
    time: Date.now() - startTime,
    action: "fire_started",
    description: "Isıtıcı yandı, yangın başladı!",
  });

  console.log("⚡ Elektrik kesildi! Yangın başladı!");
}

// Elektriği kes
function cutElectricity() {
  electricityOn = false;

  // Normal ışıkları kapat
  if (window.mainLights) {
    window.mainLights.visible = false;
  }

  // Acil durum ışıklarını aç
  if (window.emergencyLights) {
    window.emergencyLights.visible = true;
  }

  // Arka plan koyu ama tam karanlık değil; eşyalar orijinal renklerini korusun
  scene.background = new THREE.Color(0x2a2540);
  scene.fog = new THREE.Fog(0x2a2540, 5, 14);

  // Ortam ışığı azaldığında malzemeler üzerindeki parlaklık/yansıma dursun
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const m = obj.material;
    if (!m) return;
    const mats = Array.isArray(m) ? m : [m];
    mats.forEach((mat) => {
      if (mat && typeof mat.metalness !== "undefined") mat.metalness = 0;
      if (mat && typeof mat.roughness !== "undefined") mat.roughness = 0.95;
    });
  });

  console.log(
    "💡 Kaçak akım rölesi devreye girdi! Sadece acil durum ışıkları yanıyor."
  );
}

function activateAlarm() {
  if (!alarmActive) {
    const responseTime = Date.now() - startTime;
    alarmResponseTime = responseTime / 1000; // saniye cinsinden

    alarmActive = true;

    decisionLog.push({
      time: responseTime,
      action: "alarm_activated",
      description: `Alarm ${alarmResponseTime.toFixed(1)} saniyede basıldı`,
    });

    // Alarm süresine göre puan
    if (alarmResponseTime < 5) {
      userScore += 30;
      console.log("⭐ Mükemmel! Alarm hızla basıldı!");
    } else if (alarmResponseTime < 10) {
      userScore += 20;
      console.log("✓ İyi! Alarm basıldı.");
    } else {
      userScore += 10;
      console.log("⚠️ Geç kaldınız! Alarm gecikmeli basıldı.");
    }

    // UI güncelleme
    const alarmBtn = document.getElementById("alarmButton");
    if (alarmBtn) {
      alarmBtn.textContent = "ALARM AKTİF! 🚨";
      alarmBtn.style.backgroundColor = "#ff0000";
      alarmBtn.disabled = true;
    }

    // Durum güncelleme
    updateStatus();

    // Alarm sesini doğrudan çal (kullanıcı etkileşimi sonrası)
    try {
      if (!alarmAudio) {
        alarmAudio = new Audio("assets/audio/alarm.mp3");
        alarmAudio.loop = true;
        alarmAudio.volume = 0.7;
      }
      alarmAudio.currentTime = 0;
      alarmAudio
        .play()
        .then(() => {
          console.log("🔊 Alarm sesi çalıyor!");
        })
        .catch((e) => {
          console.error("Ses çalma hatası:", e);
        });
    } catch (e) {
      console.error("Alarm ses hatası:", e);
    }
  }
}

// Yangın söndürücü seç
function selectExtinguisher(type) {
  if (!fireEnable) {
    showMessage("⚠️ Henüz yangın yok! Önce yangın başlamalı.");
    return;
  }

  if (selectedExtinguisher) {
    showMessage("Zaten bir yangın söndürücü seçtiniz!");
    return;
  }

  selectedExtinguisher = type;

  decisionLog.push({
    time: Date.now() - startTime,
    action: "extinguisher_selected",
    type: type,
    description: `${type} tipi yangın söndürücü seçildi`,
  });

  // Seçime göre puan ver
  if (type === "ABC") {
    userScore += 40;
    feEnable = false; // Seçilince hemen sıkmaya başlama
    showMessage(
      "✅ Mükemmel! ABC Kuru Kimyevi Toz elektrik yangınları için doğru seçim!",
      2000
    );
    console.log("✓ ABC söndürücü seçildi - DOĞRU!");
  } else if (type === "CO2") {
    userScore += 35;
    feEnable = false; // Seçilince hemen sıkmaya başlama
    showMessage(
      "✅ Doğru! CO2 söndürücü elektrik yangınları için uygun. Dikkat: Yakın mesafeden kullanın!",
      2000
    );
    console.log("✓ CO2 söndürücü seçildi - DOĞRU (ama dikkatli kullan)");
  } else if (type === "WATER") {
    userScore -= 50;
    showMessage(
      "❌ YANLIŞ! Su ile elektrik yangını söndürülmez! ELEKTRİK ÇARPMA RİSKİ! Hasar gördünüz!"
    );
    console.log("✗ Su söndürücü seçildi - YANLIŞ! Elektrik çarpması riski!");

    // Yanlış seçimde oyun biter
    setTimeout(() => {
      endScenario("failed_wrong_extinguisher");
    }, 3000);
    return;
  }

  updateStatus();
}

function extinguishFire() {
  // Yangın söndürücü aktif olduğunda mesafe kontrolü yap
  if (feEnable && fireIntensity > 0) {
    // Yangın aşamasını kontrol et
    if (fireStage === "developed") {
      // Gelişmiş aşamada müdahale - riskli!
      showMessage("⚠️ Yangın çok büyüdü! Risk alıyorsunuz! Odayı terk edin!");
      userScore -= 30;

      decisionLog.push({
        time: Date.now() - startTime,
        action: "dangerous_intervention",
        description: "Gelişmiş aşamada yangına müdahale - riskli karar!",
      });

      setTimeout(() => {
        endScenario("failed_late_intervention");
      }, 5000);
      return;
    }

    // Kamera ile yangın arasındaki mesafeyi kontrol et
    const firePosition = new THREE.Vector3(0.4, 0.4, -1.5); // Yangın pozisyonu - masanın altında
    const cameraPosition = camera.position.clone();
    const distance = cameraPosition.distanceTo(firePosition);

    // Alevin yakınında mı kontrolü
    if (distance <= requiredDistance) {
      if (!isNearFire) {
        // İlk kez yakına geldi
        isNearFire = true;
        nearFireStartTime = Date.now();
        showMessage(
          `🧯 Yangına yakınsınız! ${requiredTime / 1000} saniye tutun...`
        );
        console.log(`Yangına yaklaşıldı! Mesafe: ${distance.toFixed(2)}m`);
      } else {
        // Yakında duruyor - süreyi kontrol et
        const timeNearFire = Date.now() - nearFireStartTime;
        const remainingTime = ((requiredTime - timeNearFire) / 1000).toFixed(1);

        if (timeNearFire < requiredTime) {
          // Hala bekleniyor
          if (Math.floor(timeNearFire / 500) % 2 === 0) {
            // Her 0.5 saniyede bir güncelle
            updateStatus();
            const statusDiv = document.getElementById("fireStatus");
            if (statusDiv) {
              statusDiv.textContent = `🧯 Yangın söndürülüyor... ${remainingTime}s`;
              statusDiv.style.color = "#ffaa00";
            }
          }
        } else {
          // 3 saniye doldu - yangını söndür!
          completeExtinguish();
        }
      }
    } else {
      // Yangından uzaklaştı
      if (isNearFire) {
        isNearFire = false;
        nearFireStartTime = 0;
        showMessage("⚠️ Yangından çok uzaksınız! Daha yakına gidin.");
        console.log(`Yangından uzaklaşıldı! Mesafe: ${distance.toFixed(2)}m`);
      }
    }

    // CO2 kullanımında özel uyarı
    if (selectedExtinguisher === "CO2" && fireIntensity > 0.5) {
      if (Math.random() < 0.01) {
        // Ara sıra uyar
        showMessage(
          "⚠️ CO2 ile uzun süreli kullanımda ortamda oksijen azalır!"
        );
      }
    }
  } else {
    // Yangın söndürücü kapalıysa zamanlayıcıyı sıfırla
    if (isNearFire) {
      isNearFire = false;
      nearFireStartTime = 0;
    }
  }
}

// Yangını tamamen söndür (3 saniye yakında durulduğunda)
function completeExtinguish() {
  fireIntensity = 0;
  fireEnable = false;
  smokeEnable = false;
  fireStage = "extinguished";
  isNearFire = false;
  nearFireStartTime = 0;

  // Başarı puanı
  const totalTime = (Date.now() - startTime) / 1000;
  if (totalTime < 30) {
    userScore += 50;
  } else if (totalTime < 60) {
    userScore += 30;
  } else {
    userScore += 10;
  }

  // Alarm sesini durdur
  if (window.stopAlarmSound) {
    window.stopAlarmSound();
  }

  decisionLog.push({
    time: Date.now() - startTime,
    action: "fire_extinguished",
    description: `Yangın ${totalTime.toFixed(1)} saniyede söndürüldü`,
  });

  showMessage("✅ Yangın başarıyla söndürüldü!");
  console.log("✅ Yangın söndürüldü!");

  // Senaryoyu başarıyla bitir
  setTimeout(() => {
    endScenario("success");
  }, 2000);
}

// Yangın söndürücüyü aç/kapat (kola tıklandığında)
function toggleFireExtinguisher() {
  if (!selectedExtinguisher) {
    showMessage("⚠️ Önce bir yangın söndürücü seçin!");
    return;
  }

  feEnable = !feEnable;

  if (feEnable) {
    showMessage("🧯 Yangın söndürücü AKTİF! Yangına yaklaşın!");
    console.log("✓ Yangın söndürücü aktif edildi");

    // GUI'yi de güncelle
    guiObject.feBoolean = true;

    // Animasyonu oynat
    if (FEAnimations && mixerFE) {
      playFeAnimations();
    }

    decisionLog.push({
      time: Date.now() - startTime,
      action: "extinguisher_activated",
      description: "Yangın söndürücü kolu basıldı",
    });
  } else {
    showMessage("🛑 Yangın söndürücü KAPANDI");
    console.log("Yangın söndürücü kapatıldı");

    guiObject.feBoolean = false;

    // Animasyonu durdur
    if (FEAnimations && mixerFE) {
      stopFeAnimations();
    }
  }

  updateStatus();
}

// Yangın aşama güncelleme
function updateFireStage() {
  if (!fireEnable) return;

  const elapsedTime = (Date.now() - startTime) / 1000;

  // 20 saniye sonra yangın gelişmiş aşamaya geçer ve bilgisayara yayılır
  if (elapsedTime > 40 && fireStage === "beginning") {
    fireStage = "developed";
    fireIntensity = 1.5; // Yangın büyüyor!

    // Bilgisayar da yanmaya başlıyor
    if (!computerFireActive) {
      computerFireActive = true;
      showMessage(
        "🔥 DİKKAT! Yangın büyüdü ve BİLGİSAYARA YAYILDI! Gelişmiş aşama - müdahale çok riskli!"
      );

      // Monitör rengini değiştir (yangın hasarı)
      if (window.computerEquipment && window.computerEquipment.monitor) {
        window.computerEquipment.monitor.material.emissive = new THREE.Color(
          0x331100
        );
        window.computerEquipment.monitor.material.emissiveIntensity = 0.5;

        // Ekranı karart (yanıyor)
        window.computerEquipment.screen.material.color = new THREE.Color(
          0x111111
        );
        window.computerEquipment.screen.material.emissive = new THREE.Color(
          0x220000
        );
        window.computerEquipment.screen.material.emissiveIntensity = 0.3;
      }
    }

    decisionLog.push({
      time: Date.now() - startTime,
      action: "fire_developed",
      description: "Yangın gelişmiş aşamaya geçti ve bilgisayara yayıldı",
    });

    // Eğer hala müdahale etmediyse...
    if (!selectedExtinguisher && alarmActive) {
      showMessage("⚠️ Çok geç kaldınız! Odayı terk edin ve kapıyı kapatın!");

      setTimeout(() => {
        if (fireStage === "developed" && !feEnable) {
          endScenario("failed_too_late");
        }
      }, 5000);
    }
  }

  // 40 saniye sonra yangın kontrol edilemez hale gelir
  if (elapsedTime > 60 && fireStage === "developed") {
    endScenario("failed_uncontrolled_fire");
  }

  // Eğer yangın gelişmişse ve kullanıcı dışarı çıktıysa BAŞARI (Kaçış)
  if (fireStage === "developed" && alarmActive && camera.position.z > 3.0) {
    endScenario("success_escape");
  }
}

// Mesaj göster
function showMessage(message, duration = 4000) {
  const messageDiv = document.getElementById("messageBox");
  if (messageDiv) {
    messageDiv.textContent = message;
    messageDiv.style.display = "block";

    setTimeout(() => {
      messageDiv.style.display = "none";
    }, duration);
  }
}

// Durum güncelle
function updateStatus() {
  const statusDiv = document.getElementById("fireStatus");
  if (!statusDiv) return;

  if (!fireEnable) {
    statusDiv.textContent = "Yangın Durumu: Beklemede";
    statusDiv.style.color = "#ffff00";
    statusDiv.style.animation = "none";
    return;
  }

  if (fireStage === "extinguished") {
    statusDiv.textContent = "✅ Yangın Başarıyla Söndürüldü!";
    statusDiv.style.color = "#00ff00";
    statusDiv.style.borderColor = "#00ff00";
    statusDiv.style.animation = "none";
  } else if (fireStage === "developed") {
    statusDiv.textContent = "🔥🔥 YANGIN GELİŞMİŞ AŞAMADA! Tehlikeli!";
    statusDiv.style.color = "#ff0000";
    statusDiv.style.borderColor = "#ff0000";
    statusDiv.style.animation = "pulse 0.3s infinite";
  } else if (selectedExtinguisher && feEnable) {
    statusDiv.textContent = `🧯 ${selectedExtinguisher} ile yangın söndürülüyor... ${Math.round(
      fireIntensity * 100
    )}%`;
    statusDiv.style.color = "#ffaa00";
    statusDiv.style.borderColor = "#ffaa00";
    statusDiv.style.animation = "none";
  } else if (alarmActive) {
    statusDiv.textContent =
      "🚨 Alarm aktif! Yangın söndürücü seçin (ABC veya CO2)";
    statusDiv.style.color = "#ff8800";
    statusDiv.style.borderColor = "#ff8800";
    statusDiv.style.animation = "none";
  } else {
    statusDiv.textContent =
      "⚡ YANGIN BAŞLADI! 🔥 Duvardaki ALARM butonuna tıklayın!";
    statusDiv.style.color = "#ff4444";
    statusDiv.style.borderColor = "#ff4444";
    statusDiv.style.animation = "pulse 0.5s infinite";
  }
}

// Senaryo sonu
function endScenario(result) {
  if (scenarioEnded) return;

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Zamanlayıcıyı ve animasyonları durdur
  scenarioEnded = true;
  timerStarted = false;

  const timerDiv = document.getElementById("timer");
  if (timerDiv) {
    timerDiv.style.display = "none";
  }

  // Tüm efektleri durdur
  fireEnable = false;
  smokeEnable = false;
  feEnable = false;

  if (window.stopAlarmSound) {
    window.stopAlarmSound();
  }

  // Sonuç ekranı göster
  const resultDiv = document.getElementById("resultScreen");
  const resultTitle = document.getElementById("resultTitle");
  const resultText = document.getElementById("resultText");
  const scoreText = document.getElementById("scoreText");
  const timeText = document.getElementById("timeText");
  const logText = document.getElementById("decisionLog");

  if (!resultDiv) return;

  resultDiv.style.display = "block";

  let title = "";
  let text = "";
  let color = "";

  switch (result) {
    case "success":
      title = "🎉 Tebrikler, Hayatımızı Kurtardınız!";
      text =
        "Yangını başarıyla söndürdünüz ve doğru kararlar aldınız. Herkes güvende!";
      color = "#00ff00";
      userScore += 50; // Bonus
      break;

    case "success_escape":
      title = "🏃‍♂️ BAŞARILI TAHLİYE!";
      text =
        "Yangın kontrol edilemez boyuta ulaştığında odayı terk ederek doğru olanı yaptınız! Lütfen hemen 112'yi arayın!";
      color = "#00ff00";
      userScore += 30;
      break;

    case "failed_wrong_extinguisher":
      title = "❌ BAŞARISIZ: Yanlış Ekipman Seçimi";
      text =
        "Su ile elektrik yangını söndürülmez! Elektrik çarpması riski nedeniyle yaralandınız.";
      color = "#ff0000";
      break;

    case "failed_late_intervention":
      title = "❌ BAŞARISIZ: Geç Müdahale";
      text =
        "Yangın gelişmiş aşamadayken müdahale ettiniz. Alevlerin arasında kaldınız.";
      color = "#ff0000";
      break;

    case "failed_too_late":
      title = "❌ BAŞARISIZ: Çok Geç Kaldınız";
      text =
        "Karar vermede çok geç kaldınız. Yangın kontrol edilemez hale geldi.";
      color = "#ff0000";
      break;

    case "failed_uncontrolled_fire":
      title = "❌ BAŞARISIZ: Yangın Kontrolden Çıktı";
      text =
        "Yangın çok büyüdü ve artık kontrol edilemiyor. Bina tahliye edilmeli.";
      color = "#ff0000";
      break;
  }

  resultTitle.textContent = title;
  resultTitle.style.color = color;
  resultText.textContent = text;
  scoreText.textContent = `Toplam Puan: ${userScore} / 200`;
  timeText.textContent = `Toplam Süre: ${totalTime} saniye`;

  if (alarmResponseTime > 0) {
    timeText.textContent += ` (Alarm: ${alarmResponseTime.toFixed(1)}s)`;
  }

  // Karar geçmişini göster
  let logHTML = "<h4>Karar Geçmişi:</h4><ul>";
  decisionLog.forEach((log) => {
    logHTML += `<li>[${(log.time / 1000).toFixed(1)}s] ${log.description}</li>`;
  });
  logHTML += "</ul>";
  logText.innerHTML = logHTML;

  console.log("=== SENARYO SONU ===");
  console.log(`Sonuç: ${result}`);

  // Kontrolleri serbest bırak
  if (controls) controls.unlock();

  // CSV Raporunu Otomatik İndir
  setTimeout(() => {
    try {
      const finalResultText = title + " - " + text;
      exportToCSV(totalTime, userScore, finalResultText);
      console.log("📊 Rapor indiriliyor...");
    } catch (e) {
      console.error("Rapor oluşturma hatası:", e);
    }
  }, 500); // 0.5sn bekleme (UI güncellensin)
  console.log(`Puan: ${userScore}`);
  console.log(`Süre: ${totalTime}s`);
}

// Ses sistemi - Web Audio API ile basit alarm sesi
let audioContext;
let alarmAudio = null;

// Global alarm durdurma fonksiyonu
window.stopAlarmSound = function () {
  if (alarmAudio) {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
    console.log("🔇 Alarm sesi durduruldu");
  }
};

function initAudio() {
  console.log("✓ Alarm ses sistemi hazır");
}

// ----------------- CSV EXPORT ------------------------

function exportToCSV(totalTime, score, resultText) {
  // Kullanıcı bilgisini al
  const user = window.userData || { name: "Bilinmeyen", surname: "Kullanıcı", startTime: new Date().toLocaleString() };

  // Excel'in sayıları "tarih" gibi otomatik biçimlendirmesini engellemek için
  // zamanı metin olarak yazdırıyoruz (örn: 00:12.3).
  function formatElapsedTime(seconds) {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const totalSecondsInt = Math.floor(safeSeconds);
    const tenths = Math.floor((safeSeconds - totalSecondsInt) * 10 + 1e-9); // 0-9

    const mins = Math.floor(totalSecondsInt / 60);
    const secs = totalSecondsInt % 60;

    const mm = String(mins).padStart(2, "0");
    const ss = String(secs).padStart(2, "0");
    return `${mm}:${ss}.${tenths}`;
  }

  // CSV İçeriği Oluştur
  let csvContent = "\uFEFF"; // UTF-8 BOM (Excel için Türkçe karakter desteği)
  csvContent += "Yangın Eğitimi Simülasyon Raporu\n";
  csvContent += "--------------------------------\n";
  csvContent += `Ad Soyad;${user.name} ${user.surname}\n`;
  csvContent += `Tarih;${user.startTime}\n`;
  csvContent += `Toplam Süre;${totalTime} saniye\n`;
  csvContent += `Puan;${score}\n`;
  csvContent += `Sonuç;${resultText.replace(/\n/g, " ")}\n\n`;

  csvContent += "--------------------------------\n";
  csvContent += "DETAYLI HAREKET DÖKÜMÜ\n";
  csvContent += "Zaman (mm:ss.s);Eylem;Açıklama\n";

  // Logları ekle
  decisionLog.forEach(log => {
    // CSV formatına uygun hale getir (noktalı virgül çakışmasını önle)
    const timeSeconds = typeof log.time === 'number' ? (log.time / 1000) : Number(log.time);
    const timeFormatted = formatElapsedTime(timeSeconds);
    // Başına apostrof koyarak Excel'de "metin" kalmasını sağla (tarih/sayıya dönmesin)
    const time = `'${timeFormatted}`;
    const desc = log.description.replace(/;/g, ",");
    csvContent += `${time};${log.action};${desc}\n`;
  });

  // Dosya İndirme İşlemi
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  // Dosya adı: Ad_Soyad_Tarih.csv
  const dateStr = new Date().toISOString().slice(0, 10);
  link.setAttribute("href", url);
  link.setAttribute("download", `Egitim_Raporu_${user.name}_${user.surname}_${dateStr}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ----------------- GUI ------------------------

function addGUI() {
  if (guiEnable) {
    gui = new GUI();
    guiCam = gui.addFolder("FireAR");

    // guiCam.add( guiObject, 'value1', 1, textureCount, 1 ).name('Texture');
    // guiCam.add( guiObject, 'value2', 0, 1 ).name('Box Brightness');
    guiCam.add(guiObject, "value3", 0, 10).name("Sahne Parlaklığı");
    // guiCam.add( guiObject, 'value4', 0, 1 ).name('Camera Damping');
    guiCam.addColor(guiObject, "color", 255).name("Zemin Rengi");
    guiCam.add(guiObject, "fireBoolean").name("🔥 Yangın");
    guiCam.add(guiObject, "smokeBoolean").name("💨 Duman");
    // Yangın söndürücü kontrolü kaldırıldı - artık kola tıklayarak aktif edilecek
    // guiCam.add(guiObject, "feBoolean").name("🧯 Yangın Söndürücü");
    guiCam.add(guiObject, "pauseBoolean").name("⏸ Duraklat");

    gui.onChange((event) => {
      console.log(event.property);
      // FE animasyonu artık kola tıklayarak kontrol edilecek
      // if (event.property == "feBoolean" && guiObject.feBoolean == true)
      //   playFeAnimations();
      // else stopFeAnimations();
    });
  }
}

// ----------------- Stats ---------------------

const stats = () => {
  if (statsEnable) {
    const stats1 = new Stats();
    stats1.showPanel(0);
    const stats2 = new Stats();
    stats2.showPanel(1);
    stats2.dom.style.cssText = "position:absolute;top:0px;left:80px;";
    const stats3 = new Stats();
    stats3.showPanel(2);
    stats3.dom.style.cssText = "position:absolute;top:0px;left:160px;";
    document.body.appendChild(stats1.dom);
    document.body.appendChild(stats2.dom);
    document.body.appendChild(stats3.dom);

    function statsUpdate() {
      requestAnimationFrame(statsUpdate);
      stats1.update();
      stats2.update();
      stats3.update();
    }
    statsUpdate();
  }
};
stats();

// Yangın Hitbox Oluşturucu
function createFireHitbox() {
  // Ateşin etrafında görünmez ama etkileşime açık büyük bir kutu
  const geometry = new THREE.BoxGeometry(1.5, 2.5, 1.5);
  const material = new THREE.MeshBasicMaterial({
    visible: false,
    wireframe: true
  });
  const hitbox = new THREE.Mesh(geometry, material);
  // Ateşin konumu: 0.4, 0.25, -1.5
  // Hitbox'ı biraz yukarı kaldırıyoruz ki tüm ateşi kapsasın
  hitbox.position.set(0.7, 1.25, -1.5);
  hitbox.name = "fireHitbox";

  if (room) {
    room.add(hitbox);
    console.log("🔥 Yangın Hitbox oluşturuldu");
  }
}

function animate() {
  requestAnimationFrame(animate);

  deltaTime = clock.getDelta();

  controls.update();
  controls.dampingFactor = guiObject.value4;

  // WASD ile birinci şahıs hareket güncellemesi
  updateFirstPersonMovement(deltaTime);

  updateInteraction();

  if (composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }

  if (mixerSmoke) {
    mixerSmoke.update(deltaTime);
    // console.log('mixerSmoke : ', mixerSmoke);
  }
  if (mixerFire) {
    // console.log('mixerFire : ', mixerFire);
  }
  if (mixerFE && modelFE) {
    mixerFE.update(deltaTime);
  }

  // baseCircle kaldırıldı
  // if (baseCircle)
  //   modelCircle.children[0].material.color = new THREE.Color(
  //     guiObject.color.r,
  //     guiObject.color.g,
  //     guiObject.color.b
  //   );

  if (!guiObject.pauseBoolean) {
    if (fireRate > 0) fireEffect.update(deltaTime * fireSpeed, fireRate);
    if (smokeRate > 0) smokeEffect.update(deltaTime * smokeSpeed, smokeRate);

    // Bilgisayar yangını (gelişmiş aşamada)
    if (computerFireActive && computerFireEffect && fireRateValue > 0) {
      const computerFireRate = fireEnable ? fireRateValue * 0.5 : 0;
      if (computerFireRate > 0) computerFireEffect.update(deltaTime * fireSpeed, computerFireRate);
    }

    // Yangın söndürücü partiküllerini sadece aktifken ve ihtiyaç olduğunda güncelle
    if (feEnable && feRate > 0) {
      feEffect.update(deltaTime * feSpeed, feRate);
    }
  }

  // Yangın aşamasını güncelle
  if (fireEnable) {
    updateFireStage();
  }

  // Yangın yoğunluğuna göre partikül oranını ayarla
  const intensityMultiplier = fireStage === "developed" ? 1.8 : 1.0;
  fireRate =
    fireEnable && guiObject.fireBoolean
      ? fireRateValue * fireIntensity * intensityMultiplier
      : 0;
  smokeRate =
    smokeEnable && guiObject.smokeBoolean
      ? smokeRateValue * fireIntensity * intensityMultiplier
      : 0;
  feRate = feEnable && guiObject.feBoolean ? feRateValue : 0;

  // Yangın söndürücü aktifse yangını söndür
  if (feEnable && guiObject.feBoolean) {
    extinguishFire();
  }

  // Durum güncelleme
  if (fireEnable || alarmActive) {
    updateStatus();
  }

  // Zamanlayıcıyı göster (sadece senaryo devam ederken)
  if (timerStarted && !scenarioEnded && fireStage !== "extinguished") {
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const timerDiv = document.getElementById("timer");
    if (timerDiv) {
      timerDiv.textContent = `⏱️ Geçen Süre: ${elapsedTime}s`;

      // Renk değişimi - süreye göre
      if (elapsedTime < 40) {
        timerDiv.style.color = "#00ff00";
      } else if (elapsedTime < 60) {
        timerDiv.style.color = "#ffaa00";
      } else {
        timerDiv.style.color = "#ff0000";
      }
    }
  }

  // console.log('fireRate : ', fireRate);

  if (feRoot.length && feRoot[1]) {
    // FPS view için partikül pozisyonu
    // feRoot[1] (FE_Origin) dünya pozisyonunu al
    const worldPosition = new THREE.Vector3();
    feRoot[1].getWorldPosition(worldPosition);
    feSpawn.position.copy(worldPosition);

    // Partikül hızını kamera yönüne göre ayarla
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);

    // Yangın pozisyonu - masanın altında
    const firePosition = new THREE.Vector3(0.4, 0.4, -1.5);

    // Spawn pozisyonundan yangına doğru yön
    const toFire = new THREE.Vector3()
      .subVectors(firePosition, feSpawn.position)
      .normalize();

    // Hız vektörünü yangına doğru ayarla
    feVelocity.copy(toFire.multiplyScalar(2.0));
  }

  // modelFE.rotation.y += .01

  // Hands & FE Visibility Update
  // Hands & FE Visibility Update
  if (handsGroup) {
    // Eğer 'WATER' seçildiyse (Hortum dolabı), el boş kalsın (veya hortum tutsun ama modelFE değil)
    // Diğer tüplerde eller gizleniyor, tüp modeli geliyor
    const holdingHandheldExtinguisher = selectedExtinguisher && selectedExtinguisher !== "WATER";

    handsGroup.visible = !holdingHandheldExtinguisher;

    // Basit bir sallanma animasyonu (yürürken)
    if (!holdingHandheldExtinguisher && (moveState.forward || moveState.backward || moveState.left || moveState.right)) {
      const time = Date.now() * 0.005;
      handsGroup.position.y = Math.sin(time) * 0.01;
      handsGroup.position.x = Math.cos(time * 0.5) * 0.005;
    } else if (!holdingHandheldExtinguisher) {
      // Dururken yavaş nefes alma hareketi
      const time = Date.now() * 0.001;
      handsGroup.position.y = Math.sin(time) * 0.005;
    }
  }

  if (modelFE) {
    // WATER seçiliyse tüp modelini gösterme
    modelFE.visible = !!selectedExtinguisher && selectedExtinguisher !== "WATER";
  }

  renderer.toneMappingExposure = guiObject.value3;
}

// ==================== ODA TURU ====================
let tourOverlay;

function showTourMessage(text, duration = 3000) {
  if (!tourOverlay) {
    tourOverlay = document.createElement("div");
    tourOverlay.style.position = "fixed";
    tourOverlay.style.bottom = "20%";
    tourOverlay.style.left = "50%";
    tourOverlay.style.transform = "translate(-50%, 0)";
    tourOverlay.style.backgroundColor = "rgba(0,0,0,0.8)";
    tourOverlay.style.color = "#00ff00";
    tourOverlay.style.padding = "20px 40px";
    tourOverlay.style.fontSize = "24px";
    tourOverlay.style.fontWeight = "bold";
    tourOverlay.style.borderRadius = "15px";
    tourOverlay.style.border = "2px solid #00ff00";
    tourOverlay.style.textAlign = "center";
    tourOverlay.style.zIndex = "10000";
    tourOverlay.style.transition = "opacity 0.5s";
    tourOverlay.style.pointerEvents = "none";
    document.body.appendChild(tourOverlay);
  }

  tourOverlay.textContent = text;
  tourOverlay.style.opacity = "1";
}

function hideTourMessage() {
  if (tourOverlay) tourOverlay.style.opacity = "0";
}

function tweenCameraLookAt(targetPos, targetLookAt, duration) {
  return new Promise((resolve) => {
    const startPos = camera.position.clone();

    // Mevcut bakış yönünü bul
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    const startLookAt = startPos.clone().add(forward.multiplyScalar(2)); // 2m ileriye bakıyor varsayalım

    const startTime = Date.now();

    function update() {
      const now = Date.now();
      let progress = (now - startTime) / duration;
      if (progress > 1) progress = 1;

      // Ease in out quadratic
      const ease =
        progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Pozisyon enterpolasyonu
      camera.position.lerpVectors(startPos, targetPos, ease);

      // Bakış enterpolasyonu
      const currentLook = new THREE.Vector3().lerpVectors(
        startLookAt,
        targetLookAt,
        ease
      );
      camera.lookAt(currentLook);

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        resolve();
      }
    }
    update();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRoomTour() {
  console.log("🎬 Otomatik oda turu başlıyor...");

  // Kontrolleri kapalı tut
  if (controls) controls.unlock();

  const initialPos = new THREE.Vector3(0, 1.6, 2.0); // Başlangıç
  const centerPos = new THREE.Vector3(0, 1.6, 0.5); // Merkeze yakın

  const targets = [
    {
      // 1. Yangın Yeri (Masa/Isıtıcı)
      pos: centerPos,
      look: new THREE.Vector3(0.7, 0.5, -1.5),
      text: "🔥 Yangın burada, ısıtıcı kaynaklı başlayacak.",
      wait: 2000,
    },
    {
      // 2. Alarm ve Tüpler (Sol Duvar)
      pos: centerPos,
      look: new THREE.Vector3(-2.4, 1.2, 1.8),
      text: "🚨 Alarm Butonu ve Yangın Tüpleri (ABC & CO2) burada.",
      wait: 2500,
    },
    {
      // 3. Yangın Dolabı (Sağ Duvar)
      pos: centerPos,
      look: new THREE.Vector3(2.4, 1.0, 1.5),
      text: "💧 Yangın Dolabı (Elektrik yangınında KULLANILMAZ!)",
      wait: 2500,
    },
    {
      // 4. Çıkış Kapısı (Arka)
      pos: new THREE.Vector3(0, 1.6, 0), // Biraz daha öne gel ki arkayı rahat dön
      look: new THREE.Vector3(0, 1.5, 3.0), // Kapıya doğru (Z=2.5)
      text: "🚪 Acil Çıkış Kapısı arkanızda bulunuyor.",
      wait: 2000,
    },
  ];

  for (const target of targets) {
    showTourMessage(target.text);
    await tweenCameraLookAt(target.pos, target.look, 1500); // 1.5 sn hareket
    await sleep(target.wait); // Bekle
  }

  // Başa dön
  hideTourMessage();
  showTourMessage("✅ Simülasyon Başlıyor! Hazır olun...", 2000);

  // Başlangıç pozisyonuna dön
  await tweenCameraLookAt(initialPos, new THREE.Vector3(0, 1.6, -2.0), 1500);

  await sleep(1000);
  hideTourMessage();

  // Başla butonunu göster
  const startBtn = document.getElementById("startScenarioBtn");
  if (startBtn) {
    startBtn.style.display = "block";

    // Butonu vurgula
    startBtn.style.transform = "translate(-50%, -50%) scale(1.1)";
    startBtn.style.transition = "transform 0.5s";
    setTimeout(() => {
      startBtn.style.transform = "translate(-50%, -50%) scale(1.0)";
    }, 500);
  }
}

// Senaryo başlatıcı
function startScenario() {
  // Başlat butonunu hemen gizle
  const startBtn = document.getElementById("startScenarioBtn");
  if (startBtn) {
    startBtn.style.display = "none";
  }

  // Senaryo talimat penceresini otomatik kapat
  const instructionsDiv = document.getElementById("instructions");
  if (instructionsDiv && !instructionsDiv.classList.contains("collapsed")) {
    instructionsDiv.classList.add("collapsed");
  }

  // Yangın durumu penceresinde uyarı göster
  const statusDiv = document.getElementById("fireStatus");
  if (statusDiv) {
    statusDiv.textContent = "🚪 Ofise giriyorsunuz...";
    statusDiv.style.color = "#ffffff";
    statusDiv.style.borderColor = "#ffffff";
  }

  setTimeout(() => {
    if (statusDiv) {
      statusDiv.textContent =
        "⚡ YANGIN BAŞLADI! 🔥 Duvardaki ALARM butonuna tıklayın!";
      statusDiv.style.color = "#ff4444";
      statusDiv.style.borderColor = "#ff4444";
      statusDiv.style.animation = "pulse 0.5s infinite";
    }

    startFire();

    // Zamanlayıcıyı göster
    const timerDiv = document.getElementById("timer");
    if (timerDiv) {
      timerDiv.style.display = "block";
    }

    // İmleci kilitle ve nişangahı göster
    if (controls && !controls.isLocked) {
      controls.lock();
    }

    const crosshair = document.getElementById("crosshair");
    if (crosshair) {
      crosshair.style.display = "block";
    }
  }, 2000);
}

// Global fonksiyonları export et
window.fireSimulation = {
  activateAlarm: activateAlarm,
  startFire: startFire,
  extinguishFire: extinguishFire,
  startScenario: startScenario,
  toggleFireExtinguisher: toggleFireExtinguisher,
  runRoomTour: runRoomTour,
};

// Sayfa yüklendiğinde Kontrol Bilgilendirme Ekranını göster
window.addEventListener("load", () => {
  setTimeout(() => {
    // Kontrolleri serbest bırak (Mouse görünsün)
    if (controls) controls.unlock();

    // Önce Kullanım Kılavuzu Ekranını Göster
    const controlsIntro = document.getElementById("controls-intro");
    if (controlsIntro) {
      controlsIntro.style.display = "block";
    }
  }, 1000);
});

// Etkileşim kontrolü (her karede çalışır)
function updateInteraction() {
  if (!controls.isLocked) {
    if (interactionHintDiv) interactionHintDiv.style.display = 'none';
    return;
  }

  const raycaster = new THREE.Raycaster();
  // Ekranın tam ortasından ray at
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  let foundInteractable = null;
  let hintText = "";

  // 1. Sahne objelerini kontrol et (Alarm, Tüpler)
  if (room) {
    const intersects = raycaster.intersectObjects(room.children, true);
    if (intersects.length > 0) {
      // En yakın objeyi al
      const object = intersects[0].object;

      // Mesafe kontrolü
      if (intersects[0].distance < 3.0) { // 3 metre etkileşim mesafesi
        if (object.name === "alarmBox") {
          foundInteractable = object;
          hintText = "🚨 ALARM İÇİN [E]";
        } else if (["ABC", "CO2", "WATER"].includes(object.name)) {
          foundInteractable = object;
          let displayName = object.name;
          if (displayName === "WATER") displayName = "SU"; // Türkçe çeviri
          hintText = `🧯 ${displayName} ALMAK İÇİN [E]`;
        } else if ((object.name === "heater" || object.name === "fireHitbox") && selectedExtinguisher && fireEnable) {
          // Eğer elimizde tüp varsa ve yangın varsa ve ısıtıcıya bakıyorsak
          foundInteractable = object;
          const actionText = guiObject.feBoolean ? "DURDURMAK" : "SÖNDÜRMEK";
          hintText = `🔥 ${actionText} İÇİN [E]`;
        } else if (object.name === "Door") {
          foundInteractable = object;
          const actionText = window.isDoorOpen ? "KAPATMAK" : "AÇMAK";
          hintText = `🚪 KAPIYI ${actionText} İÇİN [E]`;
        }
      }
    }
  }

  // 2. Eğer sahne objesi bulunamadıysa ve elimizde tüp varsa, tüpün kendisine bakıyor muyuz?
  if (!foundInteractable && modelFE && selectedExtinguisher) {
    const feIntersects = raycaster.intersectObjects(modelFE.children, true);
    if (feIntersects.length > 0) {
      // Tüp elimizdeyken herhangi bir yerine bakınca etkileşim verelim
      foundInteractable = feIntersects[0].object;
      foundInteractable.userData = foundInteractable.userData || {};
      foundInteractable.userData.isFireHandle = true;

      hintText = guiObject.feBoolean ? "KAPATMAK İÇİN [E]" : "SIKMAK İÇİN [E]";
    }
  }

  // Durumu güncelle
  currentInteractable = foundInteractable;

  // UI Güncelleme
  // Hint div'i henüz oluşturulmadıysa oluştur
  if (!interactionHintDiv) {
    interactionHintDiv = document.createElement('div');
    interactionHintDiv.style.position = 'fixed';
    interactionHintDiv.style.top = '55%'; // Ortadan biraz aşağıda
    interactionHintDiv.style.left = '50%';
    interactionHintDiv.style.transform = 'translate(-50%, -50%)';
    interactionHintDiv.style.color = '#ffffff';
    interactionHintDiv.style.fontFamily = 'Arial, sans-serif';
    interactionHintDiv.style.fontSize = '18px';
    interactionHintDiv.style.fontWeight = 'bold';
    interactionHintDiv.style.textShadow = '0px 0px 5px #000000';
    interactionHintDiv.style.pointerEvents = 'none';
    interactionHintDiv.style.display = 'none';
    interactionHintDiv.style.zIndex = '1000';
    document.body.appendChild(interactionHintDiv);
  }

  if (currentInteractable) {
    interactionHintDiv.textContent = hintText;
    interactionHintDiv.style.display = 'block';
    const crosshair = document.getElementById("crosshair");
    if (crosshair) crosshair.style.backgroundColor = "rgba(255, 255, 0, 0.9)";
  } else {
    interactionHintDiv.style.display = 'none';
    const crosshair = document.getElementById("crosshair");
    if (crosshair) crosshair.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
  }
}
