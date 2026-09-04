/**
 * STELLAR VANGUARD — Space Shoot'em Up
 * Built with Tacarigua.js v1.0.0
 * 
 * A horizontal scrolling 2D space shooter with 3 levels,
 * boss fights, particle effects, and spatial audio.
 */

import { Game, RENDER_TYPE, SCALE_MODE, CORE_EVENTS, EventEmitter, Signal } from './tacarigua/core.js';
import { ECSWorld, MovementSystem, System, TYPE } from './tacarigua/ecs.js';
import { SpatialSoundManager, SpatialSound } from './tacarigua/sound-worklet.js';

// =============================================================================
// CONSTANTS
// =============================================================================
const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;
const PLAYER_SPEED = 320;
const PLAYER_BULLET_SPEED = 700;
const PLAYER_FIRE_RATE = 150; // ms between shots
const PLAYER_MAX_LIVES = 3;
const INVULN_DURATION = 2000; // ms
const ENEMY_BULLET_SPEED = 350;

const POINTS_ENEMY_1 = 100;
const POINTS_ENEMY_2 = 150;
const POINTS_ENEMY_3 = 200;
const POINTS_BOSS_1 = 2000;
const POINTS_BOSS_2 = 3000;
const POINTS_BOSS_3 = 5000;

// Scene IDs
const SCENE = {
    LOADING: 'loading',
    MAIN_MENU: 'mainMenu',
    OPTIONS: 'options',
    LEVEL_1: 'level1',
    LEVEL_2: 'level2',
    LEVEL_3: 'level3',
    VICTORY: 'victory',
    GAME_OVER: 'gameOver'
};

// =============================================================================
// ASSET LOADER
// =============================================================================
class AssetLoader {
    constructor() {
        this.images = {};
        this.audioBuffers = {};
        this.totalAssets = 0;
        this.loadedAssets = 0;
        this.audioContext = null;
    }

    setAudioContext(ctx) {
        this.audioContext = ctx;
    }

    async loadAll(manifest) {
        const imageEntries = Object.entries(manifest.images || {});
        const audioEntries = Object.entries(manifest.audio || {});
        this.totalAssets = imageEntries.length + audioEntries.length;
        this.loadedAssets = 0;

        const promises = [];

        for (const [key, src] of imageEntries) {
            promises.push(this._loadImage(key, src));
        }

        for (const [key, src] of audioEntries) {
            promises.push(this._loadAudio(key, src));
        }

        await Promise.all(promises);
    }

    _loadImage(key, src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.images[key] = img;
                this.loadedAssets++;
                this._updateProgress();
                resolve(img);
            };
            img.onerror = () => {
                console.warn(`[Loader] Failed to load image: ${src}`);
                this.loadedAssets++;
                this._updateProgress();
                resolve(null);
            };
            img.src = src;
        });
    }

    async _loadAudio(key, src) {
        try {
            const response = await fetch(src);
            const arrayBuffer = await response.arrayBuffer();
            if (this.audioContext) {
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.audioBuffers[key] = audioBuffer;
            }
        } catch (e) {
            console.warn(`[Loader] Failed to load audio: ${src}`, e);
        }
        this.loadedAssets++;
        this._updateProgress();
    }

    _updateProgress() {
        const pct = Math.floor((this.loadedAssets / this.totalAssets) * 100);
        const fillEl = document.getElementById('loading-bar-fill');
        const pctEl = document.getElementById('loading-percent');
        if (fillEl) fillEl.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
    }

    getProgress() {
        return this.totalAssets === 0 ? 1 : this.loadedAssets / this.totalAssets;
    }
}

// =============================================================================
// PARTICLE SYSTEM (Canvas-based)
// =============================================================================
class Particle {
    constructor() {
        this.x = 0; this.y = 0;
        this.vx = 0; this.vy = 0;
        this.life = 0; this.maxLife = 0;
        this.size = 2;
        this.color = '#fff';
        this.alpha = 1;
        this.active = false;
    }
}

class ParticlePool {
    constructor(maxParticles = 500) {
        this.particles = [];
        for (let i = 0; i < maxParticles; i++) {
            this.particles.push(new Particle());
        }
    }

    emit(x, y, count, config = {}) {
        let emitted = 0;
        for (const p of this.particles) {
            if (emitted >= count) break;
            if (p.active) continue;

            p.x = x + (Math.random() - 0.5) * (config.spread || 10);
            p.y = y + (Math.random() - 0.5) * (config.spread || 10);
            const angle = config.angle != null ? config.angle + (Math.random() - 0.5) * (config.angleSpread || Math.PI * 2) : Math.random() * Math.PI * 2;
            const speed = (config.speed || 100) + Math.random() * (config.speedVariance || 80);
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed;
            p.life = config.life || 0.6;
            p.maxLife = p.life;
            p.size = config.size || (2 + Math.random() * 3);
            p.color = config.colors ? config.colors[Math.floor(Math.random() * config.colors.length)] : '#ffaa33';
            p.alpha = 1;
            p.active = true;
            emitted++;
        }
    }

    update(dt) {
        for (const p of this.particles) {
            if (!p.active) continue;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
            p.alpha = Math.max(0, p.life / p.maxLife);
            p.size *= 0.995;
            if (p.life <= 0) p.active = false;
        }
    }

    render(ctx) {
        for (const p of this.particles) {
            if (!p.active) continue;
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    clear() {
        for (const p of this.particles) p.active = false;
    }
}

// =============================================================================
// STAR FIELD (parallax background layers)
// =============================================================================
class StarField {
    constructor(layerCount = 3, starsPerLayer = 80) {
        this.layers = [];
        for (let l = 0; l < layerCount; l++) {
            const stars = [];
            const speed = 20 + l * 35;
            const brightness = 0.3 + l * 0.25;
            const size = 0.5 + l * 0.7;
            for (let i = 0; i < starsPerLayer; i++) {
                stars.push({
                    x: Math.random() * GAME_WIDTH,
                    y: Math.random() * GAME_HEIGHT,
                    size: size + Math.random() * 1.2,
                    twinkle: Math.random() * Math.PI * 2
                });
            }
            this.layers.push({ stars, speed, brightness, size });
        }
    }

    update(dt) {
        for (const layer of this.layers) {
            for (const star of layer.stars) {
                star.x -= layer.speed * dt;
                star.twinkle += dt * 2;
                if (star.x < -5) {
                    star.x = GAME_WIDTH + 5;
                    star.y = Math.random() * GAME_HEIGHT;
                }
            }
        }
    }

    render(ctx) {
        for (const layer of this.layers) {
            for (const star of layer.stars) {
                const flicker = 0.6 + 0.4 * Math.sin(star.twinkle);
                ctx.globalAlpha = layer.brightness * flicker;
                ctx.fillStyle = '#c8d8ff';
                ctx.beginPath();
                ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }
}

// =============================================================================
// SCREEN EFFECTS
// =============================================================================
class ScreenEffects {
    constructor() {
        this.shakeIntensity = 0;
        this.shakeDuration = 0;
        this.shakeTimer = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.flashAlpha = 0;
        this.flashColor = '#ffffff';
    }

    shake(intensity = 6, duration = 0.3) {
        this.shakeIntensity = intensity;
        this.shakeDuration = duration;
        this.shakeTimer = duration;
    }

    flash(color = '#ffffff', alpha = 0.4) {
        this.flashAlpha = alpha;
        this.flashColor = color;
    }

    update(dt) {
        if (this.shakeTimer > 0) {
            this.shakeTimer -= dt;
            const t = this.shakeTimer / this.shakeDuration;
            const power = this.shakeIntensity * t;
            this.offsetX = (Math.random() - 0.5) * power * 2;
            this.offsetY = (Math.random() - 0.5) * power * 2;
        } else {
            this.offsetX = 0;
            this.offsetY = 0;
        }

        if (this.flashAlpha > 0) {
            this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2);
        }
    }

    applyPre(ctx) {
        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
    }

    applyPost(ctx) {
        ctx.restore();
        if (this.flashAlpha > 0) {
            ctx.globalAlpha = this.flashAlpha;
            ctx.fillStyle = this.flashColor;
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            ctx.globalAlpha = 1;
        }
    }
}

// =============================================================================
// AUDIO MANAGER (wraps Tacarigua SpatialSoundManager & SpatialSound)
// =============================================================================
class AudioManager {
    constructor(game) {
        this.game = game;
        this.spatial = null;
        this.context = null;
        this.masterGain = null;
        this.musicGain = null;
        this.sfxGain = null;
        this.currentMusic = null;
        this.currentMusicSource = null;
        this.musicVolume = 0.5;
        this.sfxVolume = 0.7;
        this.buffers = {};
        this.initialized = false;
        this.lastMusicKey = null;
    }

    async init() {
        try {
            // Instantiate Tacarigua SpatialSoundManager
            this.spatial = new SpatialSoundManager(this.game);

            // Wait for context to initialize
            for (let i = 0; i < 15; i++) {
                if (this.spatial && this.spatial.context) break;
                await new Promise(r => setTimeout(r, 40));
            }
            this.context = this.spatial ? this.spatial.context : null;

            if (!this.context) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) this.context = new AudioCtx({ latencyHint: 'interactive' });
            }

            if (this.context) {
                this.masterGain = (this.spatial && this.spatial.masterGain) ? this.spatial.masterGain : this.context.createGain();
                if (!this.spatial || !this.spatial.masterGain) {
                    this.masterGain.connect(this.context.destination);
                    if (this.spatial) this.spatial.masterGain = this.masterGain;
                }

                this.musicGain = this.context.createGain();
                this.musicGain.gain.value = this.musicVolume;
                this.musicGain.connect(this.masterGain);

                this.sfxGain = this.context.createGain();
                this.sfxGain.gain.value = this.sfxVolume;
                this.sfxGain.connect(this.masterGain);

                this.initialized = true;
            }
        } catch (e) {
            console.warn('[Audio] Tacarigua SpatialSound init warning:', e);
        }
    }

    unlock() {
        if (this.spatial && typeof this.spatial._unlockContext === 'function') {
            this.spatial._unlockContext();
        }
        if (this.context && this.context.state === 'suspended') {
            this.context.resume().then(() => {
                if (this.lastMusicKey && !this.currentMusicSource) {
                    this.playMusic(this.lastMusicKey);
                }
            }).catch(() => {});
        } else if (this.lastMusicKey && !this.currentMusicSource) {
            this.playMusic(this.lastMusicKey);
        }
    }

    setListenerPosition(x, y, z = 0) {
        if (this.spatial && typeof this.spatial.setListenerPosition === 'function') {
            this.spatial.setListenerPosition(x, y, z);
        }
    }

    setBuffers(buffers) {
        this.buffers = buffers;
    }

    playMusic(key) {
        this.lastMusicKey = key;
        if (!this.initialized || !this.buffers[key]) return;
        this.stopMusic();
        try {
            const source = this.context.createBufferSource();
            source.buffer = this.buffers[key];
            source.loop = true;
            source.connect(this.musicGain);
            source.start(0);
            this.currentMusic = key;
            this.currentMusicSource = source;
        } catch (e) {
            console.warn('[Audio] playMusic error:', e);
        }
    }

    stopMusic() {
        if (this.currentMusicSource) {
            try { this.currentMusicSource.stop(); } catch (e) { }
            try { this.currentMusicSource.disconnect(); } catch (e) { }
            this.currentMusicSource = null;
            this.currentMusic = null;
        }
    }

    playSpatialSFX(key, x = GAME_WIDTH / 2, y = GAME_HEIGHT / 2) {
        if (!this.initialized || !this.buffers[key]) return;
        try {
            if (this.spatial && this.spatial.context) {
                const s = new SpatialSound(this.spatial, key, this.buffers[key], {
                    volume: this.sfxVolume,
                    minDistance: 250,
                    maxDistance: 1400,
                    distanceModel: 'linear'
                });
                s.setPosition(x, y, 0);
                s.play();
                return s;
            }
        } catch (e) {
            // fallback
        }
        this.playSFX(key);
    }

    playSFX(key) {
        if (!this.initialized || !this.buffers[key] || !this.context) return;
        try {
            const source = this.context.createBufferSource();
            source.buffer = this.buffers[key];
            source.connect(this.sfxGain);
            source.start(0);
        } catch (e) {
            console.warn('[Audio] playSFX error:', e);
        }
    }

    setMusicVolume(vol) {
        this.musicVolume = Math.max(0, Math.min(1, vol));
        if (this.musicGain && this.context) {
            this.musicGain.gain.setTargetAtTime(this.musicVolume, this.context.currentTime, 0.05);
        }
    }

    setSFXVolume(vol) {
        this.sfxVolume = Math.max(0, Math.min(1, vol));
        if (this.sfxGain && this.context) {
            this.sfxGain.gain.setTargetAtTime(this.sfxVolume, this.context.currentTime, 0.05);
        }
        if (this.spatial && typeof this.spatial.setMasterVolume === 'function') {
            this.spatial.setMasterVolume(this.sfxVolume);
        }
    }
}

// =============================================================================
// INPUT MANAGER (Keyboard + Mouse/Touch)
// =============================================================================
class InputManager {
    constructor() {
        this.keys = {};
        this.justPressed = {};
        this.mouse = { x: -100, y: -100, isDown: false, clicked: false };

        this._keydownHandler = (e) => {
            if (!this.keys[e.code]) {
                this.justPressed[e.code] = true;
            }
            this.keys[e.code] = true;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
                e.preventDefault();
            }
        };
        this._keyupHandler = (e) => {
            this.keys[e.code] = false;
        };
        window.addEventListener('keydown', this._keydownHandler);
        window.addEventListener('keyup', this._keyupHandler);
    }

    bindCanvas(canvas) {
        this.canvas = canvas;
        const updateCoords = (e) => {
            const rect = canvas.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                this.mouse.x = (e.clientX - rect.left) * (GAME_WIDTH / rect.width);
                this.mouse.y = (e.clientY - rect.top) * (GAME_HEIGHT / rect.height);
            }
        };
        canvas.addEventListener('pointermove', updateCoords);
        canvas.addEventListener('pointerdown', (e) => {
            updateCoords(e);
            this.mouse.isDown = true;
            this.mouse.clicked = true;
        });
        window.addEventListener('pointerup', () => {
            this.mouse.isDown = false;
        });
    }

    isDown(code) { return !!this.keys[code]; }
    isJustPressed(code) { return !!this.justPressed[code]; }

    update() {
        this.justPressed = {};
        this.mouse.clicked = false;
    }

    up() { return this.isDown('ArrowUp') || this.isDown('KeyW'); }
    down() { return this.isDown('ArrowDown') || this.isDown('KeyS'); }
    left() { return this.isDown('ArrowLeft') || this.isDown('KeyA'); }
    right() { return this.isDown('ArrowRight') || this.isDown('KeyD'); }
    fire() { return this.isDown('Space') || this.mouse.isDown; }
    enter() { return this.isJustPressed('Enter') || this.isJustPressed('Space') || this.mouse.clicked; }
    escape() { return this.isJustPressed('Escape'); }
}

// =============================================================================
// GAME STATE
// =============================================================================
class GameState {
    constructor() {
        this.reset();
    }
    reset() {
        this.score = 0;
        this.lives = PLAYER_MAX_LIVES;
        this.currentLevel = 1;
    }
    addScore(pts) {
        this.score += pts;
    }
}

// =============================================================================
// ENTITY DEFINITIONS for gameplay (using plain objects for speed)
// =============================================================================

// Simple entity store with plain arrays
class EntityStore {
    constructor() {
        this.reset();
    }

    reset() {
        this.player = null;
        this.playerBullets = [];
        this.enemies = [];
        this.enemyBullets = [];
        this.bosses = [];
    }
}

// =============================================================================
// GAMEPLAY SCENE (shared logic for all levels)
// =============================================================================
class GameplayScene {
    constructor(game, levelConfig) {
        this.game = game;
        this.ctx = game.ctx;
        this.audio = game.audio;
        this.input = game.input;
        this.images = game.loader.images;
        this.state = game.state;
        this.particles = game.particles;
        this.effects = game.effects;
        this.starField = new StarField(3, 100);

        // Level config
        this.levelNum = levelConfig.levelNum;
        this.bgKey = levelConfig.bgKey;
        this.bgImage = this.images[this.bgKey];
        this.enemyKey = levelConfig.enemyKey;
        this.bossKey = levelConfig.bossKey;
        this.musicKey = levelConfig.musicKey;
        this.enemyHP = levelConfig.enemyHP || 1;
        this.enemyPoints = levelConfig.enemyPoints || 100;
        this.bossHP = levelConfig.bossHP || 30;
        this.bossPoints = levelConfig.bossPoints || 2000;
        this.nextScene = levelConfig.nextScene;
        this.enemyPattern = levelConfig.enemyPattern || 'diagonal';

        // Background scroll
        this.bgScrollX = 0;
        this.bgScrollSpeed = 40 + this.levelNum * 10;

        // Tacarigua ECS World & Movement System
        this.ecs = new ECSWorld(2048);
        this.movementSystem = new MovementSystem(this.ecs);
        this.ecs.addSystem(this.movementSystem);

        this.Health = this.ecs.registerComponent('Health', { hp: TYPE.INT32, maxHP: TYPE.INT32 });
        this.Collider = this.ecs.registerComponent('Collider', { w: TYPE.FLOAT32, h: TYPE.FLOAT32 });
        this.Tag = this.ecs.registerComponent('Tag', { type: TYPE.UINT8 });

        // Entities store for game logic
        this.entities = new EntityStore();

        // Spawn management
        this.waveTimer = 1.0;
        this.waveInterval = 2.8;
        this.wavesSpawned = 0;
        this.totalWaves = 4;
        this.enemiesPerWave = 4 + this.levelNum;
        this.bossSpawned = false;
        this.bossDefeated = false;
        this.levelComplete = false;
        this.levelCompleteTimer = 0;

        // Firing
        this.playerFireTimer = 0;
        this.bossFireTimer = 0;
        this.enemyFireTimers = new Map();

        // Invulnerability
        this.invulnTimer = 0;

        // Transition
        this.fadeAlpha = 1;
        this.fadingIn = true;
        this.fadingOut = false;
    }

    enter() {
        this.entities.reset();
        this.particles.clear();

        // Create player
        this.entities.player = {
            x: 120, y: GAME_HEIGHT / 2,
            w: 76, h: 54,
            speed: PLAYER_SPEED,
            alive: true,
            tilt: 0
        };
        const pEntity = this.ecs.createEntity();
        this.ecs.addComponent(pEntity, this.ecs.Transform, { x: 120, y: GAME_HEIGHT / 2 });
        this.ecs.addComponent(pEntity, this.ecs.Velocity, { vx: 0, vy: 0 });
        this.ecs.addComponent(pEntity, this.Health, { hp: PLAYER_MAX_LIVES, maxHP: PLAYER_MAX_LIVES });
        this.ecs.addComponent(pEntity, this.Collider, { w: 60, h: 36 });
        this.ecs.addComponent(pEntity, this.Tag, { type: 1 });
        this.entities.player.entity = pEntity;

        this.wavesSpawned = 0;
        this.bossSpawned = false;
        this.bossDefeated = false;
        this.levelComplete = false;
        this.levelCompleteTimer = 0;
        this.waveTimer = 1.2;
        this.playerFireTimer = 0;
        this.invulnTimer = 0;
        this.fadeAlpha = 1;
        this.fadingIn = true;
        this.fadingOut = false;
        this.bgScrollX = 0;

        this.audio.playMusic(this.musicKey);
    }

    update(time, delta) {
        const dt = delta * 0.001;

        // Advance Tacarigua ECS world
        this.ecs.step(time, delta);

        // Fade in
        if (this.fadingIn) {
            this.fadeAlpha = Math.max(0, this.fadeAlpha - dt * 2);
            if (this.fadeAlpha <= 0) this.fadingIn = false;
        }

        // Fade out (level complete transition)
        if (this.fadingOut) {
            this.fadeAlpha = Math.min(1, this.fadeAlpha + dt * 1.5);
            if (this.fadeAlpha >= 1) {
                this.game.switchScene(this.nextScene);
                return;
            }
        }

        // Background scroll
        this.bgScrollX = (this.bgScrollX + this.bgScrollSpeed * dt);
        this.starField.update(dt);

        // Player movement
        const p = this.entities.player;
        if (p && p.alive) {
            let vy = 0;
            if (this.input.up()) { p.y -= p.speed * dt; vy = -1; }
            if (this.input.down()) { p.y += p.speed * dt; vy = 1; }
            if (this.input.left()) { p.x -= p.speed * dt; }
            if (this.input.right()) { p.x += p.speed * dt; }

            p.tilt = (p.tilt || 0) + (vy * 0.18 - (p.tilt || 0)) * dt * 10;

            // Clamp to screen
            p.x = Math.max(30, Math.min(GAME_WIDTH - 80, p.x));
            p.y = Math.max(35, Math.min(GAME_HEIGHT - 35, p.y));

            // Sync with ECS
            if (p.entity != null) {
                const pIdx = p.entity & 0xfffff;
                this.ecs.Transform.columns.x[pIdx] = p.x;
                this.ecs.Transform.columns.y[pIdx] = p.y;
            }

            // Firing
            this.playerFireTimer -= delta;
            if (this.input.fire() && this.playerFireTimer <= 0) {
                this.playerFireTimer = PLAYER_FIRE_RATE;
                this._spawnPlayerBullet(p.x + 45, p.y);
                this.audio.playSpatialSFX('shot', p.x, p.y);
            }

            // Spatial audio listener follows player position
            this.audio.setListenerPosition(p.x, p.y);

            // Thruster particles
            this.particles.emit(p.x - 30, p.y + 2, 2, {
                spread: 6,
                angle: Math.PI,
                angleSpread: 0.35,
                speed: 100,
                speedVariance: 50,
                life: 0.3,
                size: 2.5,
                colors: ['#00e5ff', '#80d8ff', '#e040fb', '#ffffff']
            });

            // Invulnerability timer
            if (this.invulnTimer > 0) {
                this.invulnTimer -= delta;
            }
        }

        // Wave spawning
        if (!this.bossSpawned && this.wavesSpawned < this.totalWaves) {
            this.waveTimer -= dt;
            if (this.waveTimer <= 0) {
                this._spawnWave();
                this.waveTimer = this.waveInterval;
                this.wavesSpawned++;
            }
        }

        // Check if all waves done and no enemies left => spawn boss
        if (!this.bossSpawned && this.wavesSpawned >= this.totalWaves && this.entities.enemies.length === 0) {
            this._spawnBoss();
            this.bossSpawned = true;
        }

        // Update bullets
        this._updatePlayerBullets(dt);
        this._updateEnemyBullets(dt);

        // Update enemies
        this._updateEnemies(dt, time);

        // Update bosses
        this._updateBosses(dt, time);

        // Collision: player bullets vs enemies
        this._checkBulletEnemyCollisions();

        // Collision: player bullets vs bosses
        this._checkBulletBossCollisions();

        // Collision: enemies/enemy bullets vs player
        this._checkPlayerCollisions();

        // Level complete check
        if (this.bossDefeated && !this.levelComplete) {
            this.levelComplete = true;
            this.levelCompleteTimer = 2.5;
        }
        if (this.levelComplete) {
            this.levelCompleteTimer -= dt;
            if (this.levelCompleteTimer <= 0 && !this.fadingOut) {
                this.fadingOut = true;
                this.fadeAlpha = 0;
            }
        }

        // Particles and effects
        this.particles.update(dt);
        this.effects.update(dt);

        this.input.update();
    }

    render() {
        const ctx = this.ctx;
        this.effects.applyPre(ctx);

        // Background image (tiled scroll)
        if (this.bgImage) {
            const imgW = this.bgImage.width;
            const scroll = this.bgScrollX % imgW;
            ctx.drawImage(this.bgImage, -scroll, 0, GAME_WIDTH + imgW, GAME_HEIGHT,
                0, 0, GAME_WIDTH + imgW, GAME_HEIGHT);
            // Use drawImage with repetition
            const startX = -(scroll % imgW);
            for (let x = startX; x < GAME_WIDTH; x += imgW) {
                ctx.drawImage(this.bgImage, x, 0, imgW, GAME_HEIGHT);
            }
        } else {
            ctx.fillStyle = '#050510';
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        }

        // Star field
        this.starField.render(ctx);

        // Player bullets
        const shotImg = this.images['shot'];
        for (const b of this.entities.playerBullets) {
            if (shotImg) {
                ctx.drawImage(shotImg, b.x - 12, b.y - 6, 24, 12);
            } else {
                ctx.fillStyle = '#00e5ff';
                ctx.fillRect(b.x - 8, b.y - 2, 16, 4);
            }
        }

        // Enemy bullets
        const shotEnemyImg = this.images['shot-enemy'];
        for (const b of this.entities.enemyBullets) {
            if (shotEnemyImg) {
                ctx.drawImage(shotEnemyImg, b.x - 10, b.y - 5, 20, 10);
            } else {
                ctx.fillStyle = '#ff3d3d';
                ctx.fillRect(b.x - 6, b.y - 2, 12, 4);
            }
        }

        // Enemies
        for (const e of this.entities.enemies) {
            const img = this.images[e.imageKey];
            if (img) {
                ctx.drawImage(img, e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
            } else {
                ctx.fillStyle = '#ff5252';
                ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
            }
        }

        // Boss
        for (const boss of this.entities.bosses) {
            if (!boss.alive) continue;
            const bImg = this.images[boss.imageKey];
            if (bImg) {
                // Boss glow effect
                ctx.save();
                ctx.shadowColor = '#ff3d3d';
                ctx.shadowBlur = 20 + Math.sin(performance.now() * 0.003) * 10;
                ctx.drawImage(bImg, boss.x - boss.w / 2, boss.y - boss.h / 2, boss.w, boss.h);
                ctx.restore();
            }

            // Boss health bar
            const barW = 200;
            const barH = 8;
            const barX = GAME_WIDTH / 2 - barW / 2;
            const barY = GAME_HEIGHT - 40;
            const hpRatio = boss.hp / boss.maxHP;

            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
            ctx.fillStyle = '#331111';
            ctx.fillRect(barX, barY, barW, barH);
            const hpColor = hpRatio > 0.5 ? '#ff3d3d' : hpRatio > 0.25 ? '#ff8f00' : '#ff1744';
            ctx.fillStyle = hpColor;
            ctx.fillRect(barX, barY, barW * hpRatio, barH);

            // Boss name
            ctx.fillStyle = '#ff8a80';
            ctx.font = '12px ZenDots';
            ctx.textAlign = 'center';
            ctx.fillText(boss.name, GAME_WIDTH / 2, barY - 6);
            ctx.textAlign = 'left';
        }

        // Player
        const p = this.entities.player;
        if (p && p.alive) {
            // Blinking during invulnerability
            const showPlayer = this.invulnTimer <= 0 || Math.floor(this.invulnTimer / 80) % 2 === 0;
            if (showPlayer) {
                const playerImg = this.images['player'];
                ctx.save();
                ctx.translate(p.x, p.y);
                if (p.tilt) ctx.rotate(p.tilt);
                if (playerImg) {
                    ctx.drawImage(playerImg, -p.w / 2, -p.h / 2, p.w, p.h);
                } else {
                    ctx.fillStyle = '#00e5ff';
                    ctx.beginPath();
                    ctx.moveTo(25, 0);
                    ctx.lineTo(-20, -18);
                    ctx.lineTo(-12, 0);
                    ctx.lineTo(-20, 18);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.restore();
            }
        }

        // Particles
        this.particles.render(ctx);

        // HUD
        this._renderHUD(ctx);

        // Level Complete text
        if (this.levelComplete) {
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            ctx.fillStyle = '#00e676';
            ctx.font = '36px ZenDots';
            ctx.textAlign = 'center';
            ctx.shadowColor = '#00e676';
            ctx.shadowBlur = 30;
            ctx.fillText('¡NIVEL COMPLETADO!', GAME_WIDTH / 2, GAME_HEIGHT / 2);
            ctx.shadowBlur = 0;
            ctx.textAlign = 'left';
        }

        this.effects.applyPost(ctx);

        // Fade overlay
        if (this.fadeAlpha > 0) {
            ctx.fillStyle = `rgba(0,0,0,${this.fadeAlpha})`;
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        }
    }

    _renderHUD(ctx) {
        // Score
        ctx.fillStyle = '#00e5ff';
        ctx.font = '18px ZenDots';
        ctx.textAlign = 'left';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 8;
        ctx.fillText(`SCORE: ${this.state.score.toString().padStart(8, '0')}`, 20, 35);
        ctx.shadowBlur = 0;

        // Level
        ctx.fillStyle = '#e040fb';
        ctx.font = '14px ZenDots';
        ctx.textAlign = 'center';
        ctx.fillText(`NIVEL ${this.levelNum}`, GAME_WIDTH / 2, 30);
        ctx.textAlign = 'left';

        // Lives
        ctx.fillStyle = '#ffd740';
        ctx.font = '16px ZenDots';
        ctx.textAlign = 'right';
        const livesText = '♥'.repeat(Math.max(0, this.state.lives));
        ctx.fillText(`VIDAS: ${livesText}`, GAME_WIDTH - 20, 35);
        ctx.textAlign = 'left';

        // Wave indicator
        if (!this.bossSpawned) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '11px ZenDots';
            ctx.textAlign = 'right';
            ctx.fillText(`Oleada ${Math.min(this.wavesSpawned + 1, this.totalWaves)} / ${this.totalWaves}`, GAME_WIDTH - 20, 60);
            ctx.textAlign = 'left';
        } else if (!this.bossDefeated) {
            ctx.fillStyle = '#ff5252';
            ctx.font = '12px ZenDots';
            ctx.textAlign = 'right';
            ctx.fillText('⚠ JEFE FINAL ⚠', GAME_WIDTH - 20, 60);
            ctx.textAlign = 'left';
        }
    }

    // --- Entity spawning ---

    _spawnPlayerBullet(x, y) {
        const entity = this.ecs.createEntity();
        this.ecs.addComponent(entity, this.ecs.Transform, { x, y });
        this.ecs.addComponent(entity, this.ecs.Velocity, { vx: PLAYER_BULLET_SPEED, vy: 0 });
        this.ecs.addComponent(entity, this.Collider, { w: 22, h: 8 });
        this.ecs.addComponent(entity, this.Tag, { type: 3 });

        this.entities.playerBullets.push({
            entity,
            x, y,
            vx: PLAYER_BULLET_SPEED,
            vy: 0,
            w: 22, h: 8
        });
    }

    _spawnEnemyBullet(x, y, vx, vy) {
        const entity = this.ecs.createEntity();
        this.ecs.addComponent(entity, this.ecs.Transform, { x, y });
        this.ecs.addComponent(entity, this.ecs.Velocity, { vx, vy });
        this.ecs.addComponent(entity, this.Collider, { w: 16, h: 8 });
        this.ecs.addComponent(entity, this.Tag, { type: 4 });

        this.entities.enemyBullets.push({
            entity,
            x, y, vx, vy,
            w: 16, h: 8
        });
    }

    _spawnWave() {
        const count = this.enemiesPerWave;
        for (let i = 0; i < count; i++) {
            const ex = GAME_WIDTH + 60 + i * 80;
            const ey = 80 + Math.random() * (GAME_HEIGHT - 160);
            const vx = -(80 + Math.random() * 60 + this.levelNum * 20);

            const entity = this.ecs.createEntity();
            this.ecs.addComponent(entity, this.ecs.Transform, { x: ex, y: ey });
            this.ecs.addComponent(entity, this.ecs.Velocity, { vx, vy: 0 });
            this.ecs.addComponent(entity, this.Health, { hp: this.enemyHP, maxHP: this.enemyHP });
            this.ecs.addComponent(entity, this.Collider, { w: 50, h: 40 });
            this.ecs.addComponent(entity, this.Tag, { type: 2 });

            const e = {
                entity,
                x: ex,
                y: ey,
                w: 50, h: 40,
                vx,
                vy: 0,
                hp: this.enemyHP,
                maxHP: this.enemyHP,
                imageKey: this.enemyKey,
                points: this.enemyPoints,
                pattern: this.enemyPattern,
                timer: Math.random() * Math.PI * 2,
                fireTimer: 2 + Math.random() * 3,
                alive: true
            };
            this.entities.enemies.push(e);
        }
    }

    _spawnBoss() {
        const bossConfigs = {
            1: { name: 'VOID REAVER', w: 150, h: 150, attackPattern: 'triple' },
            2: { name: 'RIXTER', w: 170, h: 210, attackPattern: 'fan' },
            3: { name: 'NEBULA TITAN', w: 170, h: 170, attackPattern: 'radial' }
        };
        const bc = bossConfigs[this.levelNum];
        const bx = GAME_WIDTH + 120;
        const by = GAME_HEIGHT / 2;

        const entity = this.ecs.createEntity();
        this.ecs.addComponent(entity, this.ecs.Transform, { x: bx, y: by });
        this.ecs.addComponent(entity, this.ecs.Velocity, { vx: 0, vy: 0 });
        this.ecs.addComponent(entity, this.Health, { hp: this.bossHP, maxHP: this.bossHP });
        this.ecs.addComponent(entity, this.Collider, { w: bc.w * 0.7, h: bc.h * 0.7 });
        this.ecs.addComponent(entity, this.Tag, { type: 5 });

        this.entities.bosses.push({
            entity,
            x: bx,
            y: by,
            w: bc.w, h: bc.h,
            targetX: GAME_WIDTH - 150,
            vx: 0, vy: 0,
            hp: this.bossHP,
            maxHP: this.bossHP,
            name: bc.name,
            imageKey: this.bossKey,
            attackPattern: bc.attackPattern,
            points: this.bossPoints,
            timer: 0,
            fireTimer: 0,
            phase: 'enter',
            alive: true
        });
    }

    // --- Update logic ---

    _updatePlayerBullets(dt) {
        const bullets = this.entities.playerBullets;
        for (let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            if (b.entity != null) {
                const idx = b.entity & 0xfffff;
                this.ecs.Transform.columns.x[idx] = b.x;
                this.ecs.Transform.columns.y[idx] = b.y;
            }
            if (b.x > GAME_WIDTH + 30) {
                if (b.entity != null) this.ecs.destroyEntity(b.entity);
                bullets.splice(i, 1);
            }
        }
    }

    _updateEnemyBullets(dt) {
        const bullets = this.entities.enemyBullets;
        for (let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            if (b.entity != null) {
                const idx = b.entity & 0xfffff;
                this.ecs.Transform.columns.x[idx] = b.x;
                this.ecs.Transform.columns.y[idx] = b.y;
            }
            if (b.x < -30 || b.x > GAME_WIDTH + 30 || b.y < -30 || b.y > GAME_HEIGHT + 30) {
                if (b.entity != null) this.ecs.destroyEntity(b.entity);
                bullets.splice(i, 1);
            }
        }
    }

    _updateEnemies(dt, time) {
        const enemies = this.entities.enemies;
        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            e.timer += dt;

            // Movement patterns
            switch (e.pattern) {
                case 'diagonal':
                    e.x += e.vx * dt;
                    e.vy = Math.sin(e.timer * 1.5) * 60;
                    e.y += e.vy * dt;
                    break;
                case 'sinusoidal':
                    e.x += e.vx * dt;
                    e.y += Math.sin(e.timer * 2.5) * 120 * dt;
                    break;
                case 'zigzag':
                    e.x += e.vx * dt;
                    e.y += (Math.sin(e.timer * 4) > 0 ? 1 : -1) * 150 * dt;
                    break;
                default:
                    e.x += e.vx * dt;
            }

            // Keep in vertical bounds
            e.y = Math.max(30, Math.min(GAME_HEIGHT - 30, e.y));

            // Sync with ECS
            if (e.entity != null) {
                const idx = e.entity & 0xfffff;
                this.ecs.Transform.columns.x[idx] = e.x;
                this.ecs.Transform.columns.y[idx] = e.y;
            }

            // Enemy shooting
            e.fireTimer -= dt;
            if (e.fireTimer <= 0 && e.x < GAME_WIDTH - 50) {
                e.fireTimer = 2.5 + Math.random() * 2;
                this._spawnEnemyBullet(e.x - e.w / 2, e.y, -ENEMY_BULLET_SPEED, 0);
            }

            // Remove off-screen
            if (e.x < -80) {
                if (e.entity != null) this.ecs.destroyEntity(e.entity);
                enemies.splice(i, 1);
            }
        }
    }

    _updateBosses(dt, time) {
        for (const boss of this.entities.bosses) {
            if (!boss.alive) continue;
            boss.timer += dt;

            // Phase: Enter
            if (boss.phase === 'enter') {
                boss.x += (boss.targetX - boss.x) * 2 * dt;
                if (Math.abs(boss.x - boss.targetX) < 5) {
                    boss.x = boss.targetX;
                    boss.phase = 'fight';
                    boss.timer = 0;
                }
                if (boss.entity != null) {
                    const idx = boss.entity & 0xfffff;
                    this.ecs.Transform.columns.x[idx] = boss.x;
                    this.ecs.Transform.columns.y[idx] = boss.y;
                }
                return;
            }

            // Vertical movement (sinusoidal)
            boss.y = GAME_HEIGHT / 2 + Math.sin(boss.timer * 0.8) * 180;

            // Sync with ECS
            if (boss.entity != null) {
                const idx = boss.entity & 0xfffff;
                this.ecs.Transform.columns.x[idx] = boss.x;
                this.ecs.Transform.columns.y[idx] = boss.y;
            }

            // Firing patterns
            boss.fireTimer -= dt;
            if (boss.fireTimer <= 0) {
                switch (boss.attackPattern) {
                    case 'triple':
                        this._bossFireTriple(boss);
                        boss.fireTimer = 1.2;
                        break;
                    case 'fan':
                        this._bossFireFan(boss);
                        boss.fireTimer = 1.5;
                        break;
                    case 'radial':
                        this._bossFireRadial(boss);
                        boss.fireTimer = 2.0;
                        break;
                }
            }

            // More aggressive when low HP
            if (boss.hp < boss.maxHP * 0.3) {
                boss.fireTimer -= dt * 0.5; // Fire faster
            }
        }
    }

    _bossFireTriple(boss) {
        for (let i = -1; i <= 1; i++) {
            this._spawnEnemyBullet(boss.x - boss.w / 2, boss.y + i * 30,
                -ENEMY_BULLET_SPEED * 1.2, i * 60);
        }
    }

    _bossFireFan(boss) {
        for (let i = -2; i <= 2; i++) {
            const angle = Math.PI + i * 0.25;
            this._spawnEnemyBullet(boss.x - boss.w / 2, boss.y,
                Math.cos(angle) * ENEMY_BULLET_SPEED * 1.1,
                Math.sin(angle) * ENEMY_BULLET_SPEED * 1.1);
        }
    }

    _bossFireRadial(boss) {
        const count = 10;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 / count) * i + boss.timer;
            this._spawnEnemyBullet(boss.x, boss.y,
                Math.cos(angle) * ENEMY_BULLET_SPEED * 0.9,
                Math.sin(angle) * ENEMY_BULLET_SPEED * 0.9);
        }
    }

    // --- Collision Detection ---

    _aabb(ax, ay, aw, ah, bx, by, bw, bh) {
        return ax - aw / 2 < bx + bw / 2 &&
               ax + aw / 2 > bx - bw / 2 &&
               ay - ah / 2 < by + bh / 2 &&
               ay + ah / 2 > by - bh / 2;
    }

    _checkBulletEnemyCollisions() {
        const bullets = this.entities.playerBullets;
        const enemies = this.entities.enemies;

        for (let bi = bullets.length - 1; bi >= 0; bi--) {
            const b = bullets[bi];
            for (let ei = enemies.length - 1; ei >= 0; ei--) {
                const e = enemies[ei];
                if (this._aabb(b.x, b.y, b.w, b.h, e.x, e.y, e.w, e.h)) {
                    if (b.entity != null) this.ecs.destroyEntity(b.entity);
                    bullets.splice(bi, 1);
                    e.hp--;
                    if (e.hp <= 0) {
                        this._explodeAt(e.x, e.y, 20, ['#ff6d00', '#ffab40', '#ffd740', '#fff176']);
                        this.state.addScore(e.points);
                        this.audio.playSpatialSFX('derrota', e.x, e.y);
                        if (e.entity != null) this.ecs.destroyEntity(e.entity);
                        enemies.splice(ei, 1);
                    } else {
                        this._explodeAt(b.x, b.y, 5, ['#ffffff', '#00e5ff']);
                    }
                    break;
                }
            }
        }
    }

    _checkBulletBossCollisions() {
        const bullets = this.entities.playerBullets;
        const bosses = this.entities.bosses;

        for (let bi = bullets.length - 1; bi >= 0; bi--) {
            const b = bullets[bi];
            for (const boss of bosses) {
                if (!boss.alive) continue;
                if (this._aabb(b.x, b.y, b.w, b.h, boss.x, boss.y, boss.w, boss.h)) {
                    if (b.entity != null) this.ecs.destroyEntity(b.entity);
                    bullets.splice(bi, 1);
                    boss.hp--;
                    this._explodeAt(b.x, b.y, 4, ['#ffffff', '#ff8a80']);
                    this.effects.shake(2, 0.1);

                    if (boss.hp <= 0) {
                        boss.alive = false;
                        this._explodeAt(boss.x, boss.y, 80, ['#ff3d3d', '#ff6d00', '#ffd740', '#ffffff', '#e040fb']);
                        this._explodeAt(boss.x - 40, boss.y + 20, 40, ['#ffab40', '#ff8f00', '#ff6d00']);
                        this._explodeAt(boss.x + 30, boss.y - 30, 40, ['#ff1744', '#d50000', '#ffd740']);
                        this.effects.shake(15, 0.8);
                        this.effects.flash('#ffffff', 0.6);
                        this.state.addScore(boss.points);
                        this.audio.playSpatialSFX('boss-explosion', boss.x, boss.y);
                        this.bossDefeated = true;
                        if (this.state.lives < PLAYER_MAX_LIVES) {
                            this.state.lives++;
                        }
                        if (boss.entity != null) this.ecs.destroyEntity(boss.entity);
                    }
                    break;
                }
            }
        }
    }

    _checkPlayerCollisions() {
        const p = this.entities.player;
        if (!p || !p.alive || this.invulnTimer > 0) return;

        // Check enemy bullets hitting player
        const eBullets = this.entities.enemyBullets;
        for (let i = eBullets.length - 1; i >= 0; i--) {
            const b = eBullets[i];
            if (this._aabb(p.x, p.y, p.w * 0.6, p.h * 0.6, b.x, b.y, b.w, b.h)) {
                if (b.entity != null) this.ecs.destroyEntity(b.entity);
                eBullets.splice(i, 1);
                this._playerHit();
                return;
            }
        }

        // Check enemies touching player
        for (let i = this.entities.enemies.length - 1; i >= 0; i--) {
            const e = this.entities.enemies[i];
            if (this._aabb(p.x, p.y, p.w * 0.5, p.h * 0.5, e.x, e.y, e.w * 0.7, e.h * 0.7)) {
                this._explodeAt(e.x, e.y, 15, ['#ff6d00', '#ff3d3d']);
                if (e.entity != null) this.ecs.destroyEntity(e.entity);
                this.entities.enemies.splice(i, 1);
                this._playerHit();
                return;
            }
        }

        // Check boss touching player
        for (const boss of this.entities.bosses) {
            if (!boss.alive) continue;
            if (this._aabb(p.x, p.y, p.w * 0.5, p.h * 0.5, boss.x, boss.y, boss.w * 0.7, boss.h * 0.7)) {
                this._playerHit();
                return;
            }
        }
    }

    _playerHit() {
        this.state.lives--;
        this.invulnTimer = INVULN_DURATION;
        this.effects.shake(8, 0.4);
        this.effects.flash('#ff3d3d', 0.3);
        this._explodeAt(this.entities.player.x, this.entities.player.y, 15, ['#ff3d3d', '#ff8a80', '#ffffff']);
        this.audio.playSpatialSFX('derrota', this.entities.player.x, this.entities.player.y);

        if (this.state.lives <= 0) {
            this.entities.player.alive = false;
            if (this.entities.player.entity != null) this.ecs.destroyEntity(this.entities.player.entity);
            this.audio.stopMusic();
            setTimeout(() => {
                this.game.switchScene(SCENE.GAME_OVER);
            }, 1500);
        }
    }

    _explodeAt(x, y, count, colors) {
        this.particles.emit(x, y, count, {
            spread: 15,
            speed: 120,
            speedVariance: 100,
            life: 0.5,
            size: 3,
            colors: colors
        });
    }

    exit() {
        this.entities.reset();
        this.particles.clear();
        if (this.ecs) this.ecs.destroy();
    }
}

// =============================================================================
// MAIN GAME CLASS
// =============================================================================
class StellarVanguard {
    constructor() {
        this.loader = new AssetLoader();
        this.audio = new AudioManager(this);
        this.input = new InputManager();
        this.state = new GameState();
        this.particles = new ParticlePool(600);
        this.effects = new ScreenEffects();
        this.starField = new StarField();

        this.canvas = null;
        this.ctx = null;
        this.currentScene = null;
        this.currentSceneId = null;
        this.scenes = {};
        this.tacariguaGame = null;

        // Menu state
        this.menuSelection = 0;
        this.menuBgScroll = 0;
        this.menuStars = new StarField(3, 120);
        this.optionsMusicVol = 0.5;
        this.optionsSfxVol = 0.7;
        this.optionsSelection = 0;

        // Victory/GameOver
        this.victoryParticleTimer = 0;
        this.goFadeAlpha = 1;

        this._init();
    }

    async _init() {
        // Initialize audio
        await this.audio.init();

        // Set audio context for loader
        if (this.audio.context) {
            this.loader.setAudioContext(this.audio.context);
        }

        // Load assets
        await this.loader.loadAll({
            images: {
                'player': 'assets/images/player.png',
                'enemy1': 'assets/images/enemy1.png',
                'enemy2': 'assets/images/enemy2.png',
                'enemy3': 'assets/images/enemy3.png',
                'boss_void_reaver': 'assets/images/boss_void_reaver.png',
                'boss_rixter': 'assets/images/boss_rixter.png',
                'boss_nebula_titan': 'assets/images/boss_nebula_titan.png',
                'shot': 'assets/images/shot.png',
                'shot-enemy': 'assets/images/shot-enemy.png',
                'bg-intro': 'assets/images/bg-intro.png',
                'bg-block': 'assets/images/bg-block.png',
                'bg-block2': 'assets/images/bg-block2.png',
                'bg-block3': 'assets/images/bg-block3.png',
                'bg-gameover': 'assets/images/bg-gameover.png'
            },
            audio: {
                'intro': 'assets/sounds/intro.ogg',
                'level1': 'assets/sounds/level1.ogg',
                'level2': 'assets/sounds/level2.ogg',
                'level3': 'assets/sounds/level3.ogg',
                'gameover': 'assets/sounds/gameover.ogg',
                'shot': 'assets/sounds/shot.ogg',
                'boss-explosion': 'assets/sounds/boss-explosion.ogg',
                'derrota': 'assets/sounds/derrota.ogg',
                'exito': 'assets/sounds/exito.ogg'
            }
        });

        // Set audio buffers
        this.audio.setBuffers(this.loader.audioBuffers);

        // Hide loading screen
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.style.transition = 'opacity 0.6s ease';
            loadingScreen.style.opacity = '0';
            setTimeout(() => loadingScreen.style.display = 'none', 600);
        }

        // Create canvas inside container
        const container = document.getElementById('game-container');
        this.canvas = document.createElement('canvas');
        this.canvas.width = GAME_WIDTH;
        this.canvas.height = GAME_HEIGHT;
        this.canvas.id = 'game-canvas';
        container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        // Bind mouse input to canvas
        this.input.bindCanvas(this.canvas);

        // Initialize Tacarigua Game engine (for TimeStep loop and lifecycle)
        this.tacariguaGame = new Game({
            canvas: this.canvas,
            parent: 'game-container',
            type: RENDER_TYPE.HEADLESS,
            width: GAME_WIDTH,
            height: GAME_HEIGHT,
            fps: { target: 60, smoothStep: true, forceSetTimeout: false }
        });
        this.audio.game = this.tacariguaGame;

        // Unlock audio on first interaction
        const unlockAudio = () => {
            this.audio.unlock();
            document.removeEventListener('pointerdown', unlockAudio);
            document.removeEventListener('keydown', unlockAudio);
        };
        document.addEventListener('pointerdown', unlockAudio, { once: true });
        document.addEventListener('keydown', unlockAudio, { once: true });

        // Register game loop with Tacarigua
        this.tacariguaGame.events.on(CORE_EVENTS.STEP, (time, delta) => {
            this._update(time, delta);
            this._render();
        });

        // Start at main menu
        this.switchScene(SCENE.MAIN_MENU);
    }

    switchScene(sceneId) {
        // Exit current scene
        if (this.currentScene && typeof this.currentScene.exit === 'function') {
            this.currentScene.exit();
        }

        this.currentSceneId = sceneId;
        this.particles.clear();

        switch (sceneId) {
            case SCENE.MAIN_MENU:
                this.currentScene = null; // handled inline
                this.menuSelection = 0;
                this.goFadeAlpha = 1;
                this.audio.playMusic('intro');
                break;

            case SCENE.OPTIONS:
                this.currentScene = null;
                this.optionsSelection = 0;
                break;

            case SCENE.LEVEL_1:
                this.state.currentLevel = 1;
                this.currentScene = new GameplayScene(this, {
                    levelNum: 1,
                    bgKey: 'bg-block',
                    enemyKey: 'enemy1',
                    bossKey: 'boss_void_reaver',
                    musicKey: 'level1',
                    enemyHP: 1,
                    enemyPoints: POINTS_ENEMY_1,
                    bossHP: 30,
                    bossPoints: POINTS_BOSS_1,
                    nextScene: SCENE.LEVEL_2,
                    enemyPattern: 'diagonal'
                });
                this.currentScene.enter();
                break;

            case SCENE.LEVEL_2:
                this.state.currentLevel = 2;
                this.currentScene = new GameplayScene(this, {
                    levelNum: 2,
                    bgKey: 'bg-block2',
                    enemyKey: 'enemy2',
                    bossKey: 'boss_rixter',
                    musicKey: 'level2',
                    enemyHP: 2,
                    enemyPoints: POINTS_ENEMY_2,
                    bossHP: 50,
                    bossPoints: POINTS_BOSS_2,
                    nextScene: SCENE.LEVEL_3,
                    enemyPattern: 'sinusoidal'
                });
                this.currentScene.enter();
                break;

            case SCENE.LEVEL_3:
                this.state.currentLevel = 3;
                this.currentScene = new GameplayScene(this, {
                    levelNum: 3,
                    bgKey: 'bg-block3',
                    enemyKey: 'enemy3',
                    bossKey: 'boss_nebula_titan',
                    musicKey: 'level3',
                    enemyHP: 3,
                    enemyPoints: POINTS_ENEMY_3,
                    bossHP: 80,
                    bossPoints: POINTS_BOSS_3,
                    nextScene: SCENE.VICTORY,
                    enemyPattern: 'zigzag'
                });
                this.currentScene.enter();
                break;

            case SCENE.VICTORY:
                this.currentScene = null;
                this.goFadeAlpha = 1;
                this.victoryParticleTimer = 0;
                this.audio.stopMusic();
                this.audio.playSFX('exito');
                break;

            case SCENE.GAME_OVER:
                this.currentScene = null;
                this.goFadeAlpha = 1;
                this.audio.playMusic('gameover');
                break;
        }
    }

    _update(time, delta) {
        const dt = delta * 0.001;

        switch (this.currentSceneId) {
            case SCENE.MAIN_MENU:
                this._updateMainMenu(dt);
                break;
            case SCENE.OPTIONS:
                this._updateOptions(dt);
                break;
            case SCENE.LEVEL_1:
            case SCENE.LEVEL_2:
            case SCENE.LEVEL_3:
                if (this.currentScene) {
                    this.currentScene.update(time, delta);
                }
                break;
            case SCENE.VICTORY:
                this._updateVictory(dt);
                break;
            case SCENE.GAME_OVER:
                this._updateGameOver(dt);
                break;
        }
    }

    _render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

        switch (this.currentSceneId) {
            case SCENE.MAIN_MENU:
                this._renderMainMenu(ctx);
                break;
            case SCENE.OPTIONS:
                this._renderOptions(ctx);
                break;
            case SCENE.LEVEL_1:
            case SCENE.LEVEL_2:
            case SCENE.LEVEL_3:
                if (this.currentScene) {
                    this.currentScene.render();
                }
                break;
            case SCENE.VICTORY:
                this._renderVictory(ctx);
                break;
            case SCENE.GAME_OVER:
                this._renderGameOver(ctx);
                break;
        }
    }

    // ===== MAIN MENU =====

    _updateMainMenu(dt) {
        this.menuBgScroll += 20 * dt;
        this.menuStars.update(dt);

        // Mouse hover and click on menu options
        const menuY = 420;
        for (let i = 0; i < 2; i++) {
            const y = menuY + i * 55;
            if (this.input.mouse.x >= GAME_WIDTH / 2 - 160 && this.input.mouse.x <= GAME_WIDTH / 2 + 160 &&
                this.input.mouse.y >= y - 22 && this.input.mouse.y <= y + 22) {
                this.menuSelection = i;
                if (this.input.mouse.clicked) {
                    this.audio.unlock();
                    if (i === 0) {
                        this.state.reset();
                        this.switchScene(SCENE.LEVEL_1);
                    } else {
                        this.switchScene(SCENE.OPTIONS);
                    }
                    this.input.update();
                    return;
                }
            }
        }

        if (this.input.isJustPressed('ArrowUp') || this.input.isJustPressed('KeyW')) {
            this.menuSelection = (this.menuSelection - 1 + 2) % 2;
        }
        if (this.input.isJustPressed('ArrowDown') || this.input.isJustPressed('KeyS')) {
            this.menuSelection = (this.menuSelection + 1) % 2;
        }
        if (this.input.enter()) {
            this.audio.unlock();
            if (this.menuSelection === 0) {
                // Play
                this.state.reset();
                this.switchScene(SCENE.LEVEL_1);
            } else {
                // Options
                this.switchScene(SCENE.OPTIONS);
            }
        }

        if (this.goFadeAlpha > 0) {
            this.goFadeAlpha = Math.max(0, this.goFadeAlpha - dt * 2);
        }

        this.input.update();
    }

    _renderMainMenu(ctx) {
        // Background
        const bgImg = this.loader.images['bg-intro'];
        if (bgImg) {
            ctx.drawImage(bgImg, 0, 0, GAME_WIDTH, GAME_HEIGHT);
        } else {
            ctx.fillStyle = '#050510';
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        }

        // Darken overlay
        ctx.fillStyle = 'rgba(3,7,16,0.55)';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

        // Stars
        this.menuStars.render(ctx);

        // Title
        const titleY = 200;
        ctx.textAlign = 'center';

        // Glow effect for title
        ctx.save();
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 30 + Math.sin(performance.now() * 0.002) * 15;
        ctx.fillStyle = '#00e5ff';
        ctx.font = '52px ZenDots';
        ctx.fillText('STELLAR', GAME_WIDTH / 2, titleY);
        ctx.font = '36px ZenDots';
        ctx.shadowColor = '#e040fb';
        ctx.fillStyle = '#e040fb';
        ctx.fillText('VANGUARD', GAME_WIDTH / 2, titleY + 50);
        ctx.restore();

        // Subtitle
        ctx.fillStyle = 'rgba(200,216,255,0.5)';
        ctx.font = '11px ZenDots';
        ctx.fillText('— BATALLAS ESPACIALES —', GAME_WIDTH / 2, titleY + 80);

        // Menu options
        const menuY = 420;
        const options = ['JUGAR', 'OPCIONES'];
        for (let i = 0; i < options.length; i++) {
            const isSelected = this.menuSelection === i;
            const y = menuY + i * 55;

            if (isSelected) {
                // Selection glow bg
                ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
                ctx.fillRect(GAME_WIDTH / 2 - 150, y - 22, 300, 40);

                // Border
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 1;
                ctx.strokeRect(GAME_WIDTH / 2 - 150, y - 22, 300, 40);

                ctx.save();
                ctx.shadowColor = '#00e5ff';
                ctx.shadowBlur = 15;
                ctx.fillStyle = '#00e5ff';
                ctx.font = '22px ZenDots';
                ctx.fillText(`▸ ${options[i]} ◂`, GAME_WIDTH / 2, y + 5);
                ctx.restore();
            } else {
                ctx.fillStyle = 'rgba(200,216,255,0.4)';
                ctx.font = '20px ZenDots';
                ctx.fillText(options[i], GAME_WIDTH / 2, y + 5);
            }
        }

        // Controls hint
        ctx.fillStyle = 'rgba(200,216,255,0.25)';
        ctx.font = '10px ZenDots';
        ctx.fillText('↑↓ NAVEGAR  ·  ENTER / ESPACIO SELECCIONAR', GAME_WIDTH / 2, GAME_HEIGHT - 40);
        ctx.fillText('WASD / FLECHAS MOVER  ·  ESPACIO DISPARAR', GAME_WIDTH / 2, GAME_HEIGHT - 22);

        ctx.textAlign = 'left';

        // Tacarigua branding
        ctx.fillStyle = 'rgba(200,216,255,0.15)';
        ctx.font = '9px ZenDots';
        ctx.textAlign = 'right';
        ctx.fillText('Powered by Tacarigua.js v1.0.0', GAME_WIDTH - 15, GAME_HEIGHT - 8);
        ctx.textAlign = 'left';

        // Fade
        if (this.goFadeAlpha > 0) {
            ctx.fillStyle = `rgba(0,0,0,${this.goFadeAlpha})`;
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        }
    }

    // ===== OPTIONS =====

    _updateOptions(dt) {
        const panelX = GAME_WIDTH / 2 - 250;
        const sliderX = panelX + 230;
        const sliderW = 200;

        // Mouse hover / click on options
        if (this.input.mouse.x >= panelX + 30 && this.input.mouse.x <= panelX + 470) {
            if (this.input.mouse.y >= 265 && this.input.mouse.y <= 315) {
                this.optionsSelection = 0;
            } else if (this.input.mouse.y >= 345 && this.input.mouse.y <= 395) {
                this.optionsSelection = 1;
            } else if (this.input.mouse.y >= 425 && this.input.mouse.y <= 475) {
                this.optionsSelection = 2;
                if (this.input.mouse.clicked) {
                    this.switchScene(SCENE.MAIN_MENU);
                    this.input.update();
                    return;
                }
            }
        }

        // Mouse drag on sliders
        if (this.input.mouse.isDown && this.input.mouse.x >= sliderX - 10 && this.input.mouse.x <= sliderX + sliderW + 10) {
            if (this.input.mouse.y >= 265 && this.input.mouse.y <= 315) {
                this.optionsSelection = 0;
                this.optionsMusicVol = Math.max(0, Math.min(1, (this.input.mouse.x - sliderX) / sliderW));
                this.audio.setMusicVolume(this.optionsMusicVol);
            } else if (this.input.mouse.y >= 345 && this.input.mouse.y <= 395) {
                this.optionsSelection = 1;
                this.optionsSfxVol = Math.max(0, Math.min(1, (this.input.mouse.x - sliderX) / sliderW));
                this.audio.setSFXVolume(this.optionsSfxVol);
            }
        }

        if (this.input.isJustPressed('ArrowUp') || this.input.isJustPressed('KeyW')) {
            this.optionsSelection = (this.optionsSelection - 1 + 3) % 3;
        }
        if (this.input.isJustPressed('ArrowDown') || this.input.isJustPressed('KeyS')) {
            this.optionsSelection = (this.optionsSelection + 1) % 3;
        }

        if (this.optionsSelection === 0) {
            if (this.input.isJustPressed('ArrowLeft') || this.input.isJustPressed('KeyA')) {
                this.optionsMusicVol = Math.max(0, this.optionsMusicVol - 0.1);
                this.audio.setMusicVolume(this.optionsMusicVol);
            }
            if (this.input.isJustPressed('ArrowRight') || this.input.isJustPressed('KeyD')) {
                this.optionsMusicVol = Math.min(1, this.optionsMusicVol + 0.1);
                this.audio.setMusicVolume(this.optionsMusicVol);
            }
        }
        if (this.optionsSelection === 1) {
            if (this.input.isJustPressed('ArrowLeft') || this.input.isJustPressed('KeyA')) {
                this.optionsSfxVol = Math.max(0, this.optionsSfxVol - 0.1);
                this.audio.setSFXVolume(this.optionsSfxVol);
            }
            if (this.input.isJustPressed('ArrowRight') || this.input.isJustPressed('KeyD')) {
                this.optionsSfxVol = Math.min(1, this.optionsSfxVol + 0.1);
                this.audio.setSFXVolume(this.optionsSfxVol);
            }
        }
        if (this.optionsSelection === 2 && this.input.enter()) {
            this.switchScene(SCENE.MAIN_MENU);
        }
        if (this.input.escape()) {
            this.switchScene(SCENE.MAIN_MENU);
        }

        this.menuStars.update(dt);
        this.input.update();
    }

    _renderOptions(ctx) {
        // Background
        const bgImg = this.loader.images['bg-intro'];
        if (bgImg) {
            ctx.drawImage(bgImg, 0, 0, GAME_WIDTH, GAME_HEIGHT);
        }
        ctx.fillStyle = 'rgba(3,7,16,0.7)';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        this.menuStars.render(ctx);

        ctx.textAlign = 'center';

        // Title
        ctx.save();
        ctx.shadowColor = '#e040fb';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#e040fb';
        ctx.font = '32px ZenDots';
        ctx.fillText('OPCIONES', GAME_WIDTH / 2, 160);
        ctx.restore();

        // Panel background
        ctx.fillStyle = 'rgba(10,14,26,0.7)';
        ctx.strokeStyle = 'rgba(0,229,255,0.15)';
        ctx.lineWidth = 1;
        const panelX = GAME_WIDTH / 2 - 250;
        const panelY = 210;
        const panelW = 500;
        const panelH = 320;
        ctx.fillRect(panelX, panelY, panelW, panelH);
        ctx.strokeRect(panelX, panelY, panelW, panelH);

        const items = [
            { label: 'MÚSICA', value: this.optionsMusicVol },
            { label: 'EFECTOS', value: this.optionsSfxVol },
            { label: 'VOLVER', value: null }
        ];

        for (let i = 0; i < items.length; i++) {
            const y = 290 + i * 80;
            const isSelected = this.optionsSelection === i;

            if (isSelected) {
                ctx.fillStyle = 'rgba(0, 229, 255, 0.06)';
                ctx.fillRect(panelX + 20, y - 25, panelW - 40, 50);
            }

            ctx.fillStyle = isSelected ? '#00e5ff' : 'rgba(200,216,255,0.5)';
            ctx.font = isSelected ? '18px ZenDots' : '16px ZenDots';

            if (items[i].value !== null) {
                // Volume slider
                ctx.textAlign = 'left';
                ctx.fillText(items[i].label, panelX + 50, y + 5);

                // Slider bar
                const sliderX = panelX + 230;
                const sliderW = 200;
                const sliderY = y - 4;
                const sliderH = 8;

                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                ctx.fillRect(sliderX, sliderY, sliderW, sliderH);

                const fillW = sliderW * items[i].value;
                ctx.fillStyle = isSelected ? '#00e5ff' : '#4fc3f7';
                ctx.fillRect(sliderX, sliderY, fillW, sliderH);

                // Knob
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(sliderX + fillW, sliderY + sliderH / 2, 6, 0, Math.PI * 2);
                ctx.fill();

                // Percentage
                ctx.textAlign = 'right';
                ctx.fillStyle = isSelected ? '#00e5ff' : 'rgba(200,216,255,0.5)';
                ctx.font = '14px ZenDots';
                ctx.fillText(Math.round(items[i].value * 100) + '%', panelX + panelW - 30, y + 5);

                if (isSelected) {
                    ctx.fillStyle = 'rgba(0,229,255,0.4)';
                    ctx.font = '12px ZenDots';
                    ctx.textAlign = 'center';
                    ctx.fillText('◄ ►', GAME_WIDTH / 2, y + 30);
                }
            } else {
                // Back button
                ctx.textAlign = 'center';
                if (isSelected) {
                    ctx.save();
                    ctx.shadowColor = '#00e5ff';
                    ctx.shadowBlur = 10;
                    ctx.fillText('▸ VOLVER ◂', GAME_WIDTH / 2, y + 5);
                    ctx.restore();
                } else {
                    ctx.fillText('VOLVER', GAME_WIDTH / 2, y + 5);
                }
            }
        }

        ctx.textAlign = 'left';

        // Hint
        ctx.fillStyle = 'rgba(200,216,255,0.25)';
        ctx.font = '10px ZenDots';
        ctx.textAlign = 'center';
        ctx.fillText('↑↓ NAVEGAR  ·  ←→ AJUSTAR  ·  ESC VOLVER', GAME_WIDTH / 2, GAME_HEIGHT - 30);
        ctx.textAlign = 'left';
    }

    // ===== VICTORY =====

    _updateVictory(dt) {
        this.menuStars.update(dt);

        if (this.goFadeAlpha > 0) {
            this.goFadeAlpha = Math.max(0, this.goFadeAlpha - dt * 2);
        }

        // Firework particles
        this.victoryParticleTimer -= dt;
        if (this.victoryParticleTimer <= 0) {
            this.victoryParticleTimer = 0.4 + Math.random() * 0.6;
            const fx = 200 + Math.random() * (GAME_WIDTH - 400);
            const fy = 100 + Math.random() * 300;
            this.particles.emit(fx, fy, 35, {
                spread: 5,
                speed: 150,
                speedVariance: 100,
                life: 0.8,
                size: 3,
                colors: ['#00e5ff', '#e040fb', '#ffd740', '#00e676', '#ff5252', '#ffffff']
            });
        }
        this.particles.update(dt);

        if (this.input.enter() || this.input.mouse.clicked) {
            this.switchScene(SCENE.MAIN_MENU);
        }
        this.input.update();
    }

    _renderVictory(ctx) {
        ctx.fillStyle = '#030710';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        this.menuStars.render(ctx);
        this.particles.render(ctx);

        ctx.textAlign = 'center';

        // Trophy glow
        ctx.save();
        ctx.shadowColor = '#ffd740';
        ctx.shadowBlur = 40 + Math.sin(performance.now() * 0.003) * 15;
        ctx.fillStyle = '#ffd740';
        ctx.font = '60px ZenDots';
        ctx.fillText('★', GAME_WIDTH / 2, 200);
        ctx.restore();

        ctx.save();
        ctx.shadowColor = '#00e676';
        ctx.shadowBlur = 25;
        ctx.fillStyle = '#00e676';
        ctx.font = '38px ZenDots';
        ctx.fillText('¡VICTORIA!', GAME_WIDTH / 2, 300);
        ctx.restore();

        ctx.fillStyle = '#e0e6f0';
        ctx.font = '16px ZenDots';
        ctx.fillText('Has defendido la galaxia con honor.', GAME_WIDTH / 2, 370);

        // Final score
        ctx.save();
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 15;
        ctx.fillStyle = '#00e5ff';
        ctx.font = '24px ZenDots';
        ctx.fillText(`PUNTUACIÓN FINAL: ${this.state.score.toString().padStart(8, '0')}`, GAME_WIDTH / 2, 440);
        ctx.restore();

        // Prompt
        const blink = Math.sin(performance.now() * 0.004) > 0;
        if (blink) {
            ctx.fillStyle = 'rgba(200,216,255,0.7)';
            ctx.font = '14px ZenDots';
            ctx.fillText('PRESIONA ENTER O CLICK PARA VOLVER AL MENÚ', GAME_WIDTH / 2, 540);
        }

        ctx.textAlign = 'left';

        // Fade
        if (this.goFadeAlpha > 0) {
            ctx.fillStyle = `rgba(0,0,0,${this.goFadeAlpha})`;
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        }
    }

    // ===== GAME OVER =====

    _updateGameOver(dt) {
        this.menuStars.update(dt);

        if (this.goFadeAlpha > 0) {
            this.goFadeAlpha = Math.max(0, this.goFadeAlpha - dt * 1.5);
        }

        if (this.input.enter() || this.input.mouse.clicked) {
            this.audio.stopMusic();
            this.switchScene(SCENE.MAIN_MENU);
        }
        this.input.update();
    }

    _renderGameOver(ctx) {
        // Background
        const bgImg = this.loader.images['bg-gameover'];
        if (bgImg) {
            ctx.drawImage(bgImg, 0, 0, GAME_WIDTH, GAME_HEIGHT);
        } else {
            ctx.fillStyle = '#0a0510';
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        }
        ctx.fillStyle = 'rgba(10,5,16,0.5)';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

        this.menuStars.render(ctx);

        ctx.textAlign = 'center';

        // Game Over text
        ctx.save();
        ctx.shadowColor = '#ff3d3d';
        ctx.shadowBlur = 35 + Math.sin(performance.now() * 0.002) * 15;
        ctx.fillStyle = '#ff3d3d';
        ctx.font = '48px ZenDots';
        ctx.fillText('GAME OVER', GAME_WIDTH / 2, 280);
        ctx.restore();

        // Score
        ctx.fillStyle = '#e0e6f0';
        ctx.font = '16px ZenDots';
        ctx.fillText('Tu nave espacial ha sido destruida...', GAME_WIDTH / 2, 350);

        ctx.save();
        ctx.shadowColor = '#ffd740';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ffd740';
        ctx.font = '20px ZenDots';
        ctx.fillText(`PUNTUACIÓN: ${this.state.score.toString().padStart(8, '0')}`, GAME_WIDTH / 2, 410);
        ctx.restore();

        // Prompt
        const blink = Math.sin(performance.now() * 0.004) > 0;
        if (blink) {
            ctx.fillStyle = 'rgba(200,216,255,0.7)';
            ctx.font = '14px ZenDots';
            ctx.fillText('PRESIONA ENTER O CLICK PARA VOLVER AL MENÚ', GAME_WIDTH / 2, 500);
        }

        ctx.textAlign = 'left';

        // Fade
        if (this.goFadeAlpha > 0) {
            ctx.fillStyle = `rgba(0,0,0,${this.goFadeAlpha})`;
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        }
    }
}

// =============================================================================
// BOOT
// =============================================================================
const game = new StellarVanguard();
