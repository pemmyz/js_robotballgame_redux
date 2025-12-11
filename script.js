// --- CONFIGURATION & CONSTANTS ---
const WIDTH = 800;
const HEIGHT = 600;

// Physics Scale: 1 Meter = 20 Pixels
const SCALE = 20;
const P_WIDTH = WIDTH / SCALE;
const P_HEIGHT = HEIGHT / SCALE;

// Dimensions
const BALL_RADIUS = 10;
const ROBOT_RADIUS = 20;
const ROBOT_HEIGHT = 25;
const GOAL_WIDTH = 120;
const GOAL_DEPTH = 20;

// Colors
let COLORS = {
    white: "white",
    black: "black",
    red: "#ff3333",
    green: "#4CAF50",
    greenSide: "#2E7D32",
    blue: "#2196F3",
    blueSide: "#1565C0",
    shadow: "rgba(0, 0, 0, 0.3)"
};

// Gameplay Constants
const ROBOT_SPEED = 14.0;          // Base Speed
const ROBOT_SPRINT_SPEED = 22.0;   // Sprint Speed
const BALL_DAMPING = 0.6;          // Air resistance for ball

const SPRINT_ENERGY_MAX = 100;
const SPRINT_COST_PER_SEC = 40;
const SPRINT_RECHARGE_PER_SEC = 20;

// Planck.js Aliases
const pl = planck;
const Vec2 = pl.Vec2;

// --- GLOBAL VARIABLES ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = WIDTH;
canvas.height = HEIGHT;

let world;
let ballBody;
let robot1, robot2; 

// Game State
let total_goals_robot1 = 0;
let total_goals_robot2 = 0;
let keysPressed = {};
let isPaused = false;
let showHelp = false;
let start_time = performance.now();
let lastFrameTime = performance.now();

// DOM Elements
const scoreTextElem = document.getElementById('scoreText');
const totalTimeTextElem = document.getElementById('totalTimeText');
const p1SprintBarFill = document.getElementById('p1SprintBarFill');
const blueStatusTextElem = document.getElementById('blueStatusText');
const p2SprintBarFill = document.getElementById('p2SprintBarFill');
const greenStatusTextElem = document.getElementById('greenStatusText');

// --- PHYSICS SETUP ---
function initPhysics() {
    world = pl.World(Vec2(0, 0)); 

    const wallOpts = { density: 0.0, friction: 0.2, restitution: 0.5 };
    const goalHalfW = (GOAL_WIDTH / SCALE) / 2;

    // Create Walls
    world.createBody().createFixture(pl.Edge(Vec2(0, 0), Vec2(P_WIDTH, 0)), wallOpts);
    world.createBody().createFixture(pl.Edge(Vec2(0, P_HEIGHT), Vec2(P_WIDTH, P_HEIGHT)), wallOpts);
    
    world.createBody().createFixture(pl.Edge(Vec2(0, 0), Vec2(0, P_HEIGHT/2 - goalHalfW)), wallOpts);
    world.createBody().createFixture(pl.Edge(Vec2(0, P_HEIGHT/2 + goalHalfW), Vec2(0, P_HEIGHT)), wallOpts);
    world.createBody().createFixture(pl.Edge(Vec2(P_WIDTH, 0), Vec2(P_WIDTH, P_HEIGHT/2 - goalHalfW)), wallOpts);
    world.createBody().createFixture(pl.Edge(Vec2(P_WIDTH, P_HEIGHT/2 + goalHalfW), Vec2(P_WIDTH, P_HEIGHT)), wallOpts);
    
    const gd = GOAL_DEPTH / SCALE;
    const makeGoal = (x, dir) => {
        const g = world.createBody();
        const xBack = x + (dir * gd);
        g.createFixture(pl.Edge(Vec2(x, P_HEIGHT/2 - goalHalfW), Vec2(xBack, P_HEIGHT/2 - goalHalfW))); 
        g.createFixture(pl.Edge(Vec2(x, P_HEIGHT/2 + goalHalfW), Vec2(xBack, P_HEIGHT/2 + goalHalfW))); 
        g.createFixture(pl.Edge(Vec2(xBack, P_HEIGHT/2 - goalHalfW), Vec2(xBack, P_HEIGHT/2 + goalHalfW))); 
    };
    makeGoal(0, -1);       
    makeGoal(P_WIDTH, 1);  
}

// --- CLASSES ---

class RobotEntity {
    constructor(startX, startY, color, sideColor, goalTargetX, aiIndex) {
        this.color = color;
        this.sideColor = sideColor;
        this.goalTargetX = goalTargetX;
        
        this.body = world.createBody({
            type: 'dynamic',
            position: Vec2(startX / SCALE, startY / SCALE),
            linearDamping: 1.0, 
            fixedRotation: true
        });
        
        this.body.createFixture(pl.Circle(ROBOT_RADIUS / SCALE), {
            density: 2.0, 
            friction: 0.3,
            restitution: 0.1
        });

        this.sprintEnergy = SPRINT_ENERGY_MAX;
        this.isSprinting = false;
        this.hasBall = false;

        this.inputVec = Vec2(0, 0);
        this.wantsSprint = false;
        this.wantsCatch = false;

        this.aiModes = ["NONE", "DEFAULT", "DEFENSIVE", "AGGRESSIVE"];
        this.aiModeIndex = aiIndex;
        this.aiMode = this.aiModes[this.aiModeIndex];
    }

    cycleAI() {
        this.aiModeIndex = (this.aiModeIndex + 1) % this.aiModes.length;
        this.aiMode = this.aiModes[this.aiModeIndex];
        // Stop movement when switching modes
        this.inputVec = Vec2(0,0);
        this.body.setLinearVelocity(Vec2(0,0));
    }

    update(dt) {
        if (this.aiMode !== "NONE") {
            this.runAI();
        }

        // Energy
        if (!this.isSprinting && this.sprintEnergy < SPRINT_ENERGY_MAX) {
            this.sprintEnergy += SPRINT_RECHARGE_PER_SEC * dt;
        }

        // Velocity Calculation
        let speed = ROBOT_SPEED;
        
        if (this.wantsSprint && this.sprintEnergy > 1) {
            this.isSprinting = true;
            speed = ROBOT_SPRINT_SPEED;
            this.sprintEnergy -= SPRINT_COST_PER_SEC * dt;
        } else {
            this.isSprinting = false;
        }

        let desiredVel = Vec2(0, 0);
        if (this.inputVec.length() > 0.1) {
            this.inputVec.normalize();
            desiredVel = Vec2.mul(this.inputVec, speed);
        }

        // Apply Velocity with Smoothing
        const currentVel = this.body.getLinearVelocity();
        // ** FIX IS HERE: changed lengthSq() to lengthSquared() **
        let smoothFactor = (desiredVel.lengthSquared() > 0.1) ? 0.2 : 0.15;
        
        const newVel = Vec2.add(
            Vec2.mul(currentVel, 1.0 - smoothFactor),
            Vec2.mul(desiredVel, smoothFactor)
        );
        
        this.body.setLinearVelocity(newVel);
        this.body.setAwake(true); 

        // Catch Logic
        const bPos = ballBody.getPosition();
        const rPos = this.body.getPosition();
        const distToBall = Vec2.distance(bPos, rPos);
        const catchRange = (ROBOT_RADIUS + BALL_RADIUS + 5) / SCALE;

        if (this.wantsCatch && distToBall < catchRange) {
            this.hasBall = true;
            let dir = this.body.getLinearVelocity();
            if (dir.length() < 0.5) dir = Vec2(this.goalTargetX > WIDTH/2 ? 1 : -1, 0);
            dir.normalize();
            
            const holdDist = (ROBOT_RADIUS + BALL_RADIUS + 2) / SCALE;
            const targetBallPos = Vec2.add(rPos, Vec2.mul(dir, holdDist));
            
            const pull = Vec2.sub(targetBallPos, bPos);
            ballBody.setLinearVelocity(Vec2.mul(pull, 10)); 
            ballBody.setAngularVelocity(0);
        } else {
            this.hasBall = false;
        }
    }

    runAI() {
        const bPos = ballBody.getPosition();
        const rPos = this.body.getPosition();
        
        let target = bPos; 

        if (this.aiMode === "DEFENSIVE") {
            const defenseX = (this.goalTargetX < WIDTH/2) ? P_WIDTH - 8 : 8; 
            if (Math.abs(bPos.x - defenseX) > 10) {
                 target = Vec2(defenseX, P_HEIGHT/2); 
                 if (Vec2.distance(bPos, rPos) < 15) target = bPos; 
            }
        } else if (this.aiMode === "AGGRESSIVE" && this.hasBall) {
            target = Vec2(this.goalTargetX/SCALE, P_HEIGHT/2);
        }

        const diff = Vec2.sub(target, rPos);
        if (diff.length() > 0.5) this.inputVec = diff;
        else this.inputVec = Vec2(0,0);

        const dist = Vec2.distance(bPos, rPos);
        this.wantsSprint = (dist > 8 && this.sprintEnergy > 30);
        this.wantsCatch = (dist < 3);
    }
}

// --- GAME LIFECYCLE ---

function resetGame() {
    let ai1 = 0, ai2 = 0;
    if (robot1) ai1 = robot1.aiModeIndex;
    if (robot2) ai2 = robot2.aiModeIndex;

    if(ballBody) world.destroyBody(ballBody);
    if(robot1) world.destroyBody(robot1.body);
    if(robot2) world.destroyBody(robot2.body);

    ballBody = world.createBody({
        type: 'dynamic',
        position: Vec2(P_WIDTH / 2, P_HEIGHT / 2),
        linearDamping: BALL_DAMPING,
        angularDamping: 0.8
    });
    ballBody.createFixture(pl.Circle(BALL_RADIUS / SCALE), { 
        density: 0.8, restitution: 0.7, friction: 0.3 
    });
    ballBody.setLinearVelocity(Vec2((Math.random()-0.5)*8, (Math.random()-0.5)*8));

    robot1 = new RobotEntity(150, HEIGHT/2, COLORS.blue, COLORS.blueSide, WIDTH, ai1);
    robot2 = new RobotEntity(WIDTH - 150, HEIGHT/2, COLORS.green, COLORS.greenSide, 0, ai2);

    start_time = performance.now();
}

// --- RENDERING ---

function drawShadow(x, y, r) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.shadow;
    ctx.fill();
}

function drawCylinder(x, y, r, h, colorTop, colorSide, isSprinting) {
    drawShadow(x, y, r * 1.2);
    
    if (isSprinting) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.ellipse(x, y, r*1.4, r*1.4*0.5, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
    }

    ctx.fillStyle = colorSide;
    ctx.fillRect(x - r, y - h, r * 2, h);
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI, false); ctx.fill(); 
    
    ctx.beginPath(); ctx.ellipse(x, y - h, r, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = colorTop; ctx.fill(); ctx.stroke();
}

function drawSphere(x, y, r, color) {
    drawShadow(x, y + 4, r * 0.9);
    const drawY = y - r;
    
    const grad = ctx.createRadialGradient(x - r*0.3, drawY - r*0.3, r*0.2, x, drawY, r);
    grad.addColorStop(0, "#ff8888");
    grad.addColorStop(1, "#aa0000");
    
    ctx.beginPath(); ctx.arc(x, drawY, r, 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.stroke();
}

function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = COLORS.black; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(WIDTH/2, HEIGHT/2, 60, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(WIDTH/2, 0); ctx.lineTo(WIDTH/2, HEIGHT); ctx.stroke();
    
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.fillRect(0, HEIGHT/2 - GOAL_WIDTH/2, GOAL_DEPTH, GOAL_WIDTH);
    ctx.fillRect(WIDTH - GOAL_DEPTH, HEIGHT/2 - GOAL_WIDTH/2, GOAL_DEPTH, GOAL_WIDTH);

    const objects = [
        { type: 'ball', y: ballBody.getPosition().y * SCALE, x: ballBody.getPosition().x * SCALE },
        { type: 'robot', obj: robot1, y: robot1.body.getPosition().y * SCALE, x: robot1.body.getPosition().x * SCALE },
        { type: 'robot', obj: robot2, y: robot2.body.getPosition().y * SCALE, x: robot2.body.getPosition().x * SCALE }
    ];
    objects.sort((a, b) => a.y - b.y);

    objects.forEach(o => {
        if (o.type === 'ball') drawSphere(o.x, o.y, BALL_RADIUS, COLORS.red);
        else {
            drawCylinder(o.x, o.y, ROBOT_RADIUS, ROBOT_HEIGHT, o.obj.color, o.obj.sideColor, o.obj.isSprinting);
            
            const vel = o.obj.body.getLinearVelocity();
            if (vel.length() > 0.5) {
                const angle = Math.atan2(vel.y, vel.x);
                ctx.save(); ctx.translate(o.x, o.y - ROBOT_HEIGHT); ctx.rotate(angle);
                ctx.fillStyle = "rgba(255,255,255,0.9)";
                ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(0, 6); ctx.lineTo(0, -6); ctx.fill();
                ctx.restore();
            }
        }
    });
}

// --- INPUT HANDLING ---

function handleInput() {
    if (!robot1 || !robot2) return;

    let r1x = 0, r1y = 0;
    let r2x = 0, r2y = 0;

    if (keysPressed['ArrowUp']) r1y = -1;
    if (keysPressed['ArrowDown']) r1y = 1;
    if (keysPressed['ArrowLeft']) r1x = -1;
    if (keysPressed['ArrowRight']) r1x = 1;
    
    robot1.inputVec = Vec2(r1x, r1y);
    robot1.wantsSprint = !!keysPressed['KeyN'];
    robot1.wantsCatch = !!keysPressed['KeyM'];

    if (keysPressed['KeyW']) r2y = -1;
    if (keysPressed['KeyS']) r2y = 1;
    if (keysPressed['KeyA']) r2x = -1;
    if (keysPressed['KeyD']) r2x = 1;

    robot2.inputVec = Vec2(r2x, r2y);
    robot2.wantsSprint = !!keysPressed['KeyV'];
    robot2.wantsCatch = !!keysPressed['KeyB'];
}

window.addEventListener('keydown', (e) => {
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    
    if(e.code === 'KeyP') { isPaused = !isPaused; return; }
    if(e.code === 'KeyH') { showHelp = !showHelp; isPaused = showHelp; return; }
    if(e.code === 'Digit1') { robot1.cycleAI(); return; }
    if(e.code === 'Digit2') { robot2.cycleAI(); return; }
    
    keysPressed[e.code] = true;
});

window.addEventListener('keyup', (e) => {
    keysPressed[e.code] = false;
});

const touchButtons = [
    {id:'p1TouchUp', k:'ArrowUp'}, {id:'p1TouchDown', k:'ArrowDown'}, 
    {id:'p1TouchLeft', k:'ArrowLeft'}, {id:'p1TouchRight', k:'ArrowRight'},
    {id:'p1TouchSprint', k:'KeyN'}, {id:'p1TouchCatch', k:'KeyM'},
    {id:'p2TouchUp', k:'KeyW'}, {id:'p2TouchDown', k:'KeyS'}, 
    {id:'p2TouchLeft', k:'KeyA'}, {id:'p2TouchRight', k:'KeyD'},
    {id:'p2TouchSprint', k:'KeyV'}, {id:'p2TouchCatch', k:'KeyB'}
];

touchButtons.forEach(btn => {
    const el = document.getElementById(btn.id);
    if(el) {
        const press = (e) => { if(e.cancelable) e.preventDefault(); keysPressed[btn.k] = true; };
        const release = (e) => { if(e.cancelable) e.preventDefault(); keysPressed[btn.k] = false; };
        
        el.addEventListener('mousedown', press);
        el.addEventListener('touchstart', press, {passive: false});
        el.addEventListener('mouseup', release);
        el.addEventListener('touchend', release, {passive: false});
        el.addEventListener('mouseleave', release);
    }
});

// --- UI & LOOP ---

function updateUI() {
    const bPos = ballBody.getPosition();
    const bx = bPos.x * SCALE;
    
    if (bx < -5 && Math.abs((bPos.y*SCALE) - HEIGHT/2) < GOAL_WIDTH/2 + 20) {
        total_goals_robot2++; resetGame();
    } else if (bx > WIDTH + 5 && Math.abs((bPos.y*SCALE) - HEIGHT/2) < GOAL_WIDTH/2 + 20) {
        total_goals_robot1++; resetGame();
    }

    if (bx < -50 || bx > WIDTH + 50 || bPos.y*SCALE < -50 || bPos.y*SCALE > HEIGHT + 50) {
        resetGame();
    }

    scoreTextElem.textContent = `Score: Blue ${total_goals_robot1} - Green ${total_goals_robot2}`;
    
    p1SprintBarFill.style.width = robot1.sprintEnergy + "%";
    blueStatusTextElem.textContent = `Status: ${robot1.aiMode}`;
    p2SprintBarFill.style.width = robot2.sprintEnergy + "%";
    greenStatusTextElem.textContent = `Status: ${robot2.aiMode}`;
    
    totalTimeTextElem.textContent = `Time: ${Math.floor((performance.now() - start_time)/1000)}s`;
    
    if (document.body.classList.contains('light-mode')) {
        COLORS.white = "#222"; COLORS.black = "#222";
    } else {
        COLORS.white = "white"; COLORS.black = "white";
    }
}

function loop() {
    requestAnimationFrame(loop);

    const now = performance.now();
    let dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    if (dt > 0.1) dt = 0.1; 

    if (isPaused || showHelp) {
        render();
        if(showHelp) drawHelp();
        else drawPause();
        return;
    }

    handleInput();
    robot1.update(dt);
    robot2.update(dt);
    
    world.step(1/60); 

    render();
    updateUI();
}

function drawHelp() {
    ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(40, 40, WIDTH-80, HEIGHT-80);
    ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 24px Arial";
    ctx.fillText("CONTROLS", WIDTH/2, 90);
    ctx.font = "16px Arial"; ctx.textAlign = "left"; let y = 140;
    ctx.fillText("PLAYER 1 (Blue): Arrows, N (Sprint), M (Catch)", 80, y);
    ctx.fillText("PLAYER 2 (Green): WASD, V (Sprint), B (Catch)", 80, y+=40);
    ctx.fillText("SYSTEM: P (Pause), H (Help), 1/2 (Cycle AI)", 80, y+=40);
}

function drawPause() {
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "40px Arial";
    ctx.fillText("PAUSED", WIDTH/2, HEIGHT/2);
}

document.getElementById('darkModeToggle').addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
});

initPhysics();
resetGame();
loop();
