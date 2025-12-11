// --- CONFIGURATION & CONSTANTS ---
const WIDTH = 800;
const HEIGHT = 600;

// Physics Scale: 1 Meter = 20 Pixels
const SCALE = 20;
const P_WIDTH = WIDTH / SCALE;
const P_HEIGHT = HEIGHT / SCALE;

// 2.5D Dimensions (in Pixels)
const BALL_RADIUS = 10;
const ROBOT_RADIUS = 20;
const ROBOT_HEIGHT = 25; // Height of the cylinder
const GOAL_WIDTH = 120;
const GOAL_DEPTH = 20;

// Colors
let COLORS = {
    white: "white",
    black: "black",
    red: "red",
    ballGradient: ["#ff5555", "#aa0000"],
    green: "#4CAF50",
    greenSide: "#2E7D32",
    blue: "#2196F3",
    blueSide: "#1565C0",
    shadow: "rgba(0, 0, 0, 0.3)"
};

// Gameplay Constants
const ROBOT_FORCE_SPEED = 30.0; // Force applied for movement
const ROBOT_MAX_SPEED = 12.0;   // Max velocity in m/s
const ROBOT_SPRINT_MULTIPLIER = 1.6;
const BALL_DAMPING = 0.8;       // Air resistance
const ROBOT_DAMPING = 5.0;      // Friction

const SPRINT_ENERGY_MAX = 100;
const SPRINT_COST_PER_SEC = 35;
const SPRINT_RECHARGE_PER_SEC = 15;
const KICK_IMPULSE = 0.8;       // Physics impulse for kick

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
let robot1, robot2; // Objects containing body + game state
let goalBodies = [];

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
const roundTimeTextElem = document.getElementById('roundTimeText');
const pauseHelpTextElem = document.getElementById('pauseHelpText');
const p1SprintBarFill = document.getElementById('p1SprintBarFill');
const blueStatusTextElem = document.getElementById('blueStatusText');
const p2SprintBarFill = document.getElementById('p2SprintBarFill');
const greenStatusTextElem = document.getElementById('greenStatusText');

// --- PHYSICS SETUP ---
function initPhysics() {
    world = pl.World(Vec2(0, 0)); // No gravity (top-down)

    // Boundaries (Top, Bottom, Left-Top, Left-Bottom, Right-Top, Right-Bottom)
    // We leave gaps for goals
    const wallOpts = { density: 0.0, friction: 0.5 };
    const goalHalfW = (GOAL_WIDTH / SCALE) / 2;

    // Top Wall
    world.createBody().createFixture(pl.Edge(Vec2(0, 0), Vec2(P_WIDTH, 0)), wallOpts);
    // Bottom Wall
    world.createBody().createFixture(pl.Edge(Vec2(0, P_HEIGHT), Vec2(P_WIDTH, P_HEIGHT)), wallOpts);
    
    // Left Walls (split by goal)
    world.createBody().createFixture(pl.Edge(Vec2(0, 0), Vec2(0, P_HEIGHT/2 - goalHalfW)), wallOpts);
    world.createBody().createFixture(pl.Edge(Vec2(0, P_HEIGHT/2 + goalHalfW), Vec2(0, P_HEIGHT)), wallOpts);

    // Right Walls (split by goal)
    world.createBody().createFixture(pl.Edge(Vec2(P_WIDTH, 0), Vec2(P_WIDTH, P_HEIGHT/2 - goalHalfW)), wallOpts);
    world.createBody().createFixture(pl.Edge(Vec2(P_WIDTH, P_HEIGHT/2 + goalHalfW), Vec2(P_WIDTH, P_HEIGHT)), wallOpts);
    
    // Goal Backs (Sensors or physical walls? Let's make physical deep nets)
    const goalDepthM = GOAL_DEPTH / SCALE;
    // Left Goal Box
    const lg = world.createBody();
    lg.createFixture(pl.Edge(Vec2(0, P_HEIGHT/2 - goalHalfW), Vec2(-goalDepthM, P_HEIGHT/2 - goalHalfW)));
    lg.createFixture(pl.Edge(Vec2(0, P_HEIGHT/2 + goalHalfW), Vec2(-goalDepthM, P_HEIGHT/2 + goalHalfW)));
    lg.createFixture(pl.Edge(Vec2(-goalDepthM, P_HEIGHT/2 - goalHalfW), Vec2(-goalDepthM, P_HEIGHT/2 + goalHalfW)));
    
    // Right Goal Box
    const rg = world.createBody();
    rg.createFixture(pl.Edge(Vec2(P_WIDTH, P_HEIGHT/2 - goalHalfW), Vec2(P_WIDTH + goalDepthM, P_HEIGHT/2 - goalHalfW)));
    rg.createFixture(pl.Edge(Vec2(P_WIDTH, P_HEIGHT/2 + goalHalfW), Vec2(P_WIDTH + goalDepthM, P_HEIGHT/2 + goalHalfW)));
    rg.createFixture(pl.Edge(Vec2(P_WIDTH + goalDepthM, P_HEIGHT/2 - goalHalfW), Vec2(P_WIDTH + goalDepthM, P_HEIGHT/2 + goalHalfW)));
}

// --- CLASSES ---

class RobotEntity {
    constructor(startX, startY, color, sideColor, goalTargetX, aiIndex) {
        this.color = color;
        this.sideColor = sideColor; // For 3D effect
        this.goalTargetX = goalTargetX; // Pixel coord
        
        // Physics Body
        this.body = world.createBody({
            type: 'dynamic',
            position: Vec2(startX / SCALE, startY / SCALE),
            linearDamping: ROBOT_DAMPING,
            fixedRotation: true // Robots don't spin
        });
        
        this.body.createFixture(pl.Circle(ROBOT_RADIUS / SCALE), {
            density: 1.0,
            friction: 0.3,
            restitution: 0.2
        });

        // Stats
        this.sprintEnergy = SPRINT_ENERGY_MAX;
        this.isSprinting = false;
        this.isCatching = false;
        this.hasBall = false;

        // AI
        this.aiModes = ["NONE", "DEFAULT", "DEFENSIVE", "AGGRESSIVE"];
        this.aiModeIndex = aiIndex;
        this.aiMode = this.aiModes[this.aiModeIndex];
    }

    cycleAI() {
        this.aiModeIndex = (this.aiModeIndex + 1) % this.aiModes.length;
        this.aiMode = this.aiModes[this.aiModeIndex];
        this.body.setLinearVelocity(Vec2(0,0));
    }

    update(dt) {
        // Energy Regen
        if (!this.isSprinting && this.sprintEnergy < SPRINT_ENERGY_MAX) {
            this.sprintEnergy += SPRINT_RECHARGE_PER_SEC * dt;
            if (this.sprintEnergy > SPRINT_ENERGY_MAX) this.sprintEnergy = SPRINT_ENERGY_MAX;
        }

        // Logic (Manual or AI)
        let moveVec = Vec2(0, 0);
        let wantSprint = false;
        let wantCatch = false;
        let wantKick = false; // Logic trigger

        if (this.aiMode === "NONE") {
            // Manual Input handled externally, stored in properties
            moveVec = this.manualMove || Vec2(0,0);
            wantSprint = this.manualSprint;
            wantCatch = this.manualCatch;
        } else {
            // AI Logic
            const bPos = ballBody.getPosition();
            const rPos = this.body.getPosition();
            const dist = Vec2.distance(bPos, rPos);
            
            // Simple AI State Machine
            let target = bPos; // Default go to ball

            if (this.aiMode === "DEFENSIVE") {
                // Stay between ball and defended goal
                const defGoalX = (this.goalTargetX < WIDTH/2) ? P_WIDTH : 0; // Defending opposite of target
                const midPoint = Vec2((bPos.x + defGoalX)/2, bPos.y);
                if (dist > 5) target = midPoint; // If ball far, back up
            } else if (this.aiMode === "AGGRESSIVE") {
                // If has ball, go to goal
                if (this.hasBall) target = Vec2(this.goalTargetX / SCALE, P_HEIGHT/2);
            }

            // Move towards target
            const diff = Vec2.sub(target, rPos);
            if (diff.length() > 0.1) {
                diff.normalize();
                moveVec = diff;
            }

            // Auto Sprint/Kick
            if (dist > 5 && this.sprintEnergy > 30) wantSprint = true;
            if (dist < (ROBOT_RADIUS + BALL_RADIUS + 5)/SCALE) {
                 wantCatch = true;
                 // Kick if aligned with goal
                 const goalDir = (this.goalTargetX > WIDTH/2) ? 1 : -1;
                 const ballDir = (bPos.x > rPos.x) ? 1 : -1;
                 if (goalDir === ballDir) wantKick = true;
            }
        }

        // Apply Sprint
        let speedMult = 1.0;
        if (wantSprint && this.sprintEnergy > 0) {
            this.isSprinting = true;
            speedMult = ROBOT_SPRINT_MULTIPLIER;
            this.sprintEnergy -= SPRINT_COST_PER_SEC * dt;
        } else {
            this.isSprinting = false;
        }

        // Apply Movement Force
        if (moveVec.length() > 0) {
            moveVec.normalize();
            // desired velocity
            const desiredVel = Vec2.mul(moveVec, ROBOT_MAX_SPEED * speedMult);
            const currentVel = this.body.getLinearVelocity();
            // Force = Mass * ChangeInVel / Time (simplified impulse approach)
            // Or just set velocity for tighter arcade control
            // Planck approach: apply force to reach velocity
            const velChange = Vec2.sub(desiredVel, currentVel);
            const force = Vec2.mul(velChange, this.body.getMass() * 10); // 10 is responsiveness
            this.body.applyForceToCenter(force);
        }

        // Catch / Dribble Logic
        const bPos = ballBody.getPosition();
        const rPos = this.body.getPosition();
        const distToBall = Vec2.distance(bPos, rPos);
        const catchRange = (ROBOT_RADIUS + BALL_RADIUS + 5) / SCALE;

        if (wantCatch && distToBall < catchRange) {
            this.hasBall = true;
            // Magnetic Dribble: Pull ball to a point in front of robot
            // Determine "front" based on movement or goal direction
            let facing = this.body.getLinearVelocity();
            if (facing.length() < 0.1) {
                facing = Vec2((this.goalTargetX > WIDTH/2 ? 1 : -1), 0);
            }
            facing.normalize();
            const dribbleSpot = Vec2.add(rPos, Vec2.mul(facing, (ROBOT_RADIUS + BALL_RADIUS + 2)/SCALE));
            
            // Move ball towards spot smoothly
            const pull = Vec2.sub(dribbleSpot, bPos);
            ballBody.setLinearVelocity(Vec2.mul(pull, 10)); // Snap velocity
            ballBody.setAngularVelocity(0);
        } else {
            this.hasBall = false;
        }

        // Kick Logic (AI triggers immediate kick, Player kicks differently if needed, 
        // but here we map catch key release or specific logic to kick)
        // For simple player control: collisions do the kicking naturally. 
        // We add a boost if "Catch" isn't held but collision happens? 
        // Let's implement an active "Kick" if currently holding ball and releasing, or just collision.
        // Simplified: The physics engine handles the "kick" via collision restitution. 
        // However, if we want a power kick, we apply impulse.
        
        // Manual kick override: if we had the ball, and now we don't catch, launch it.
        // (Omitted for simplicity, standard physics collision + sprint speed gives good kicks)
        if (this.aiMode !== "NONE" && wantKick && this.hasBall) {
             const goalDir = Vec2((this.goalTargetX/SCALE) - bPos.x, (P_HEIGHT/2) - bPos.y);
             goalDir.normalize();
             ballBody.applyLinearImpulse(Vec2.mul(goalDir, KICK_IMPULSE), bPos);
             this.hasBall = false;
        }
    }
}

// --- SETUP GAME ---

function resetGame() {
    // Preserve AI modes
    let ai1 = 0, ai2 = 0;
    if (robot1) ai1 = robot1.aiModeIndex;
    if (robot2) ai2 = robot2.aiModeIndex;

    // Clear world bodies
    // Note: iterating and destroying inside step is bad, but reset happens usually outside step
    // Easiest is to recreate world or destroy known actors
    if (ballBody) world.destroyBody(ballBody);
    if (robot1) world.destroyBody(robot1.body);
    if (robot2) world.destroyBody(robot2.body);

    // Create Ball
    ballBody = world.createBody({
        type: 'dynamic',
        position: Vec2(P_WIDTH / 2, P_HEIGHT / 2),
        linearDamping: BALL_DAMPING,
        angularDamping: 0.5
    });
    ballBody.createFixture(pl.Circle(BALL_RADIUS / SCALE), {
        density: 0.5,
        restitution: 0.8, // Bouncy
        friction: 0.2
    });
    // Random Start Velocity
    ballBody.setLinearVelocity(Vec2((Math.random()-0.5)*10, (Math.random()-0.5)*10));

    // Create Robots
    // Robot 1 (Left, Blue) -> Targets Right Goal
    robot1 = new RobotEntity(150, HEIGHT/2, COLORS.blue, COLORS.blueSide, WIDTH, ai1);
    
    // Robot 2 (Right, Green) -> Targets Left Goal
    robot2 = new RobotEntity(WIDTH - 150, HEIGHT/2, COLORS.green, COLORS.greenSide, 0, ai2);

    start_time = performance.now();
}

// --- RENDERING (2.5D) ---

function drawShadow(x, y, r) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.shadow;
    ctx.fill();
}

function drawCylinder(x, y, r, h, colorTop, colorSide) {
    // Draw Shadow
    drawShadow(x, y, r * 1.2);

    // Draw Side (Rectangle covering the height)
    ctx.fillStyle = colorSide;
    ctx.fillRect(x - r, y - h, r * 2, h);
    
    // Draw Bottom Curve (to round off the cylinder base visually)
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI, false); // Bottom half
    ctx.fill();

    // Draw Top Circle
    ctx.beginPath();
    ctx.ellipse(x, y - h, r, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = colorTop;
    ctx.fill();
    ctx.stroke(); // Outline for cartoon look
}

function drawSphere(x, y, r, z, color) {
    // Shadow
    const shadowScale = Math.max(0.5, 1 - (z/100)); // Smaller shadow if higher (not used here much)
    drawShadow(x, y + 5, r * shadowScale); // Slight offset

    const drawY = y - z - r; // Center of sphere visually

    ctx.beginPath();
    ctx.arc(x, drawY, r, 0, Math.PI * 2);
    
    // Gradient for 3D look
    const grad = ctx.createRadialGradient(x - r*0.3, drawY - r*0.3, r*0.2, x, drawY, r);
    grad.addColorStop(0, "#ffaaaa");
    grad.addColorStop(0.5, "#ff0000");
    grad.addColorStop(1, "#880000");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
}

function render() {
    // 1. Clear Canvas
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // 2. Draw Field markings (flat)
    ctx.strokeStyle = COLORS.black;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(WIDTH/2, HEIGHT/2, 50, 0, Math.PI*2);
    ctx.moveTo(WIDTH/2, 0); ctx.lineTo(WIDTH/2, HEIGHT);
    ctx.stroke();
    // Goals (Flat rects on ground)
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(0, HEIGHT/2 - GOAL_WIDTH/2, GOAL_DEPTH, GOAL_WIDTH);
    ctx.fillRect(WIDTH - GOAL_DEPTH, HEIGHT/2 - GOAL_WIDTH/2, GOAL_DEPTH, GOAL_WIDTH);

    // 3. Prepare Objects for Z-Sorting
    // We sort by Y coordinate (plus a bit of Z offset) so lower objects draw over higher ones.
    let objects = [];

    // Ball
    const bPos = ballBody.getPosition();
    objects.push({
        type: 'ball',
        y: bPos.y * SCALE,
        x: bPos.x * SCALE,
        z: 0 // On ground
    });

    // Robot 1
    const r1Pos = robot1.body.getPosition();
    objects.push({
        type: 'robot',
        obj: robot1,
        y: r1Pos.y * SCALE,
        x: r1Pos.x * SCALE
    });

    // Robot 2
    const r2Pos = robot2.body.getPosition();
    objects.push({
        type: 'robot',
        obj: robot2,
        y: r2Pos.y * SCALE,
        x: r2Pos.x * SCALE
    });

    // Sort: Painter's Algorithm
    objects.sort((a, b) => a.y - b.y);

    // 4. Draw Objects
    objects.forEach(o => {
        if (o.type === 'ball') {
            drawSphere(o.x, o.y, BALL_RADIUS, o.z, COLORS.red);
        } else if (o.type === 'robot') {
            const rob = o.obj;
            // Pulse effect if sprinting
            let r = ROBOT_RADIUS;
            if(rob.isSprinting) r += Math.sin(performance.now()/100) * 2;
            
            drawCylinder(o.x, o.y, r, ROBOT_HEIGHT, rob.color, rob.sideColor);
            
            // Draw Direction Indicator (small triangle on top)
            const vel = rob.body.getLinearVelocity();
            if (vel.length() > 0.1) {
                const angle = Math.atan2(vel.y, vel.x);
                ctx.save();
                ctx.translate(o.x, o.y - ROBOT_HEIGHT);
                ctx.rotate(angle);
                ctx.fillStyle = "rgba(255,255,255,0.8)";
                ctx.beginPath();
                ctx.moveTo(10, 0);
                ctx.lineTo(-5, 5);
                ctx.lineTo(-5, -5);
                ctx.fill();
                ctx.restore();
            }
        }
    });

    // 5. Draw Goal Posts (Simulated 3D posts)
    // Front posts need to be drawn last if they are "south"
    // For simplicity, we just draw lines for now or could add them to sort list.
}

// --- INPUT HANDLING ---

function handleInput() {
    // Player 1
    robot1.manualMove = Vec2(0,0);
    robot1.manualSprint = keysPressed['KeyN'];
    robot1.manualCatch = keysPressed['KeyM'];
    if (keysPressed['ArrowUp']) robot1.manualMove.y -= 1;
    if (keysPressed['ArrowDown']) robot1.manualMove.y += 1;
    if (keysPressed['ArrowLeft']) robot1.manualMove.x -= 1;
    if (keysPressed['ArrowRight']) robot1.manualMove.x += 1;

    // Player 2
    robot2.manualMove = Vec2(0,0);
    robot2.manualSprint = keysPressed['KeyV'];
    robot2.manualCatch = keysPressed['KeyB'];
    if (keysPressed['KeyW']) robot2.manualMove.y -= 1;
    if (keysPressed['KeyS']) robot2.manualMove.y += 1;
    if (keysPressed['KeyA']) robot2.manualMove.x -= 1;
    if (keysPressed['KeyD']) robot2.manualMove.x += 1;
}

window.addEventListener('keydown', (e) => {
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    if(e.code === 'KeyP') { isPaused = !isPaused; return; }
    if(e.code === 'KeyH') { showHelp = !showHelp; isPaused = showHelp; return; }
    if(e.code === 'Digit1') { robot1.cycleAI(); return; }
    if(e.code === 'Digit2') { robot2.cycleAI(); return; }
    keysPressed[e.code] = true;
});
window.addEventListener('keyup', (e) => keysPressed[e.code] = false);

// Touch Controls
const touchMap = [
    {id:'p1TouchUp', k:'ArrowUp'}, {id:'p1TouchDown', k:'ArrowDown'}, 
    {id:'p1TouchLeft', k:'ArrowLeft'}, {id:'p1TouchRight', k:'ArrowRight'},
    {id:'p1TouchSprint', k:'KeyN'}, {id:'p1TouchCatch', k:'KeyM'},
    {id:'p2TouchUp', k:'KeyW'}, {id:'p2TouchDown', k:'KeyS'}, 
    {id:'p2TouchLeft', k:'KeyA'}, {id:'p2TouchRight', k:'KeyD'},
    {id:'p2TouchSprint', k:'KeyV'}, {id:'p2TouchCatch', k:'KeyB'}
];
touchMap.forEach(m => {
    const el = document.getElementById(m.id);
    if(el) {
        el.addEventListener('touchstart', (e)=>{e.preventDefault(); keysPressed[m.k]=true;});
        el.addEventListener('touchend', (e)=>{e.preventDefault(); keysPressed[m.k]=false;});
        el.addEventListener('mousedown', (e)=>{keysPressed[m.k]=true;});
        el.addEventListener('mouseup', (e)=>{keysPressed[m.k]=false;});
    }
});

// --- UI UPDATES ---
function updateUI() {
    // Scores
    const bPos = ballBody.getPosition();
    const bx = bPos.x * SCALE;
    // Simple Goal check (Physics engines usually use sensors, but coordinates work for simple box goals)
    if (bx < 0 && Math.abs((bPos.y*SCALE) - HEIGHT/2) < GOAL_WIDTH/2) {
        total_goals_robot2++; resetGame();
    } else if (bx > WIDTH && Math.abs((bPos.y*SCALE) - HEIGHT/2) < GOAL_WIDTH/2) {
        total_goals_robot1++; resetGame();
    }

    scoreTextElem.textContent = `Score: Blue ${total_goals_robot1} - Green ${total_goals_robot2}`;
    
    // Status
    p1SprintBarFill.style.width = robot1.sprintEnergy + "%";
    blueStatusTextElem.textContent = `Status: ${robot1.aiMode}`;
    p2SprintBarFill.style.width = robot2.sprintEnergy + "%";
    greenStatusTextElem.textContent = `Status: ${robot2.aiMode}`;

    const now = performance.now();
    totalTimeTextElem.textContent = `Time: ${Math.floor((now - start_time)/1000)}s`;
    
    // Dark Mode Colors
    if (document.body.classList.contains('light-mode')) {
        COLORS.white = "#222"; COLORS.black = "#222";
    } else {
        COLORS.white = "white"; COLORS.black = "white";
    }
}

// --- MAIN LOOP ---
function loop() {
    const now = performance.now();
    const dt = Math.min((now - lastFrameTime) / 1000, 0.05); // Cap dt
    lastFrameTime = now;

    if (!isPaused && !showHelp) {
        handleInput();
        robot1.update(dt);
        robot2.update(dt);
        
        // Physics Step
        // 60Hz simulation regardless of framerate
        world.step(1/60);
        // Clear forces after step? Planck does this automatically for applyForce
    }

    render();
    if (showHelp) drawHelp();
    else if (isPaused) drawPause();
    else updateUI();

    requestAnimationFrame(loop);
}

function drawHelp() {
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(50, 50, WIDTH-100, HEIGHT-100);
    ctx.fillStyle = "white";
    ctx.font = "20px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Controls", WIDTH/2, 100);
    ctx.font = "16px Arial";
    ctx.textAlign = "left";
    let y = 150;
    ctx.fillText("Player 1 (Blue): Arrows to Move, N to Sprint, M to Catch", 80, y+=30);
    ctx.fillText("Player 2 (Green): WASD to Move, V to Sprint, B to Catch", 80, y+=30);
    ctx.fillText("System: P to Pause, H for Help, 1/2 to toggle AI", 80, y+=30);
}

function drawPause() {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "white";
    ctx.font = "40px Arial";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", WIDTH/2, HEIGHT/2);
}

// --- INIT ---
const darkModeToggleBtn = document.getElementById('darkModeToggle');
darkModeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    darkModeToggleBtn.textContent = document.body.classList.contains('light-mode') ? '🌙 Dark Mode' : '☀️ Light Mode';
});

initPhysics();
resetGame();
loop();
