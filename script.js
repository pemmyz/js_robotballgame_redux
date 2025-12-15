// --- CONFIGURATION & CONSTANTS ---
const WIDTH = 800;
const HEIGHT = 600;
const SCALE = 20; // 1 Meter = 20 Pixels
const P_WIDTH = WIDTH / SCALE;
const P_HEIGHT = HEIGHT / SCALE;

let GAME_CONFIG = {
    robotSpeed: 14.0,
    sprintSpeed: 24.0, 
    ballRestitution: 0.7,
    sprintDrain: 40,
    sprintRecharge: 20
};

// Dimensions
const BALL_RADIUS = 10;
const ROBOT_RADIUS = 20;
const ROBOT_HEIGHT = 25;
const GOAL_WIDTH = 120;
const GOAL_DEPTH = 20;

let COLORS = {
    white: "white", black: "black",
    red: "#ff3333", green: "#4CAF50", greenSide: "#2E7D32",
    blue: "#2196F3", blueSide: "#1565C0", shadow: "rgba(0, 0, 0, 0.3)"
};

const pl = planck;
const Vec2 = pl.Vec2;

// --- GLOBAL VARIABLES ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = WIDTH; canvas.height = HEIGHT;

let world;
let ballBody;
let robot1, robot2; 
let keysPressed = {};

const STATE = { MENU: 0, PLAYING: 1, AUTOBOT: 2 };
let currentState = STATE.MENU;

let score = { blue: 0, green: 0 };
let startTime = 0;
let lastFrameTime = performance.now();
let isPaused = false;
let showHelp = false;

// Menu Timer
let menuIdleTime = 0;
const IDLE_THRESHOLD = 6;
let idleTimerActive = true;

// UI Elements
const uiMenu = document.getElementById('mainMenu');
const uiOptions = document.getElementById('optionsMenu');
const uiGame = document.getElementById('inGameUI');
const elCountdown = document.getElementById('countdownTimer');
const elScore = document.getElementById('scoreText');
const elTime = document.getElementById('totalTimeText');
const elSprint1 = document.getElementById('p1SprintBarFill');
const elSprint2 = document.getElementById('p2SprintBarFill');
const elStatus1 = document.getElementById('blueStatusText');
const elStatus2 = document.getElementById('greenStatusText');

// --- PHYSICS SETUP ---
function initPhysics() {
    world = pl.World(Vec2(0, 0)); 
    const wallOpts = { density: 0.0, friction: 0.2, restitution: 0.5 };
    const goalHalfW = (GOAL_WIDTH / SCALE) / 2;

    // Walls
    world.createBody().createFixture(pl.Edge(Vec2(0, 0), Vec2(P_WIDTH, 0)), wallOpts);
    world.createBody().createFixture(pl.Edge(Vec2(0, P_HEIGHT), Vec2(P_WIDTH, P_HEIGHT)), wallOpts);
    
    // Goal Boxes
    const makeWall = (v1, v2) => world.createBody().createFixture(pl.Edge(v1, v2), wallOpts);
    makeWall(Vec2(0, 0), Vec2(0, P_HEIGHT/2 - goalHalfW));
    makeWall(Vec2(0, P_HEIGHT/2 + goalHalfW), Vec2(0, P_HEIGHT));
    makeWall(Vec2(P_WIDTH, 0), Vec2(P_WIDTH, P_HEIGHT/2 - goalHalfW));
    makeWall(Vec2(P_WIDTH, P_HEIGHT/2 + goalHalfW), Vec2(P_WIDTH, P_HEIGHT));
    
    const gd = GOAL_DEPTH / SCALE;
    const makeGoalBox = (x, dir) => {
        const g = world.createBody();
        const xb = x + (dir * gd);
        g.createFixture(pl.Edge(Vec2(x, P_HEIGHT/2 - goalHalfW), Vec2(xb, P_HEIGHT/2 - goalHalfW))); 
        g.createFixture(pl.Edge(Vec2(x, P_HEIGHT/2 + goalHalfW), Vec2(xb, P_HEIGHT/2 + goalHalfW))); 
        g.createFixture(pl.Edge(Vec2(xb, P_HEIGHT/2 - goalHalfW), Vec2(xb, P_HEIGHT/2 + goalHalfW))); 
    };
    makeGoalBox(0, -1);       
    makeGoalBox(P_WIDTH, 1);  
}

// --- ROBOT CLASS ---
class RobotEntity {
    constructor(startX, startY, color, sideColor, goalTargetX, aiType) {
        this.color = color;
        this.sideColor = sideColor;
        this.goalTargetX = goalTargetX; // Where I score
        
        this.body = world.createBody({
            type: 'dynamic',
            position: Vec2(startX / SCALE, startY / SCALE),
            linearDamping: 1.0, fixedRotation: true
        });
        
        this.body.createFixture(pl.Circle(ROBOT_RADIUS / SCALE), {
            density: 2.0, friction: 0.3, restitution: 0.1
        });

        this.sprintEnergy = 100;
        this.isSprinting = false;
        
        this.aiTypes = ["PLAYER", "DEFAULT", "DEFENSIVE", "AGGRESSIVE", "CHAOTIC"];
        this.setAI(aiType);
        
        this.inputVec = Vec2(0, 0);
        this.wantsSprint = false;
        this.wantsCatch = false;
        
        this.stuckTimer = 0;
        this.randomTimer = 0;
        this.randomTarget = null;
    }

    setAI(type) {
        if(this.aiTypes.includes(type)) this.aiType = type;
        else this.aiType = "DEFAULT";
    }

    cycleAI() {
        let idx = this.aiTypes.indexOf(this.aiType);
        idx = (idx + 1) % this.aiTypes.length;
        this.aiType = this.aiTypes[idx];
    }

    update(dt) {
        if (this.aiType !== "PLAYER") this.runAI(dt);

        // Anti-Stuck Logic
        const currentVel = this.body.getLinearVelocity();
        if (this.inputVec.length() > 0.5 && currentVel.length() < 0.5) {
            this.stuckTimer += dt;
        } else {
            this.stuckTimer = 0;
        }

        if (this.stuckTimer > 0.5) {
            if (Math.random() > 0.5) {
                this.inputVec = Vec2(Math.random()-0.5, Math.random()-0.5);
                this.inputVec.normalize();
            }
        }

        // --- 1. SPRINT LOGIC & ENERGY ---
        // Base Speed
        let targetSpeed = GAME_CONFIG.robotSpeed;
        
        // Recharge Energy
        if (!this.wantsSprint && this.sprintEnergy < 100) {
            this.sprintEnergy += GAME_CONFIG.sprintRecharge * dt;
        }

        // Apply Sprint
        this.isSprinting = false;
        if (this.wantsSprint && this.sprintEnergy > 1) {
            this.isSprinting = true;
            targetSpeed = GAME_CONFIG.sprintSpeed; // Switch to faster speed
            this.sprintEnergy -= GAME_CONFIG.sprintDrain * dt;
        }

        // --- 2. CARRYING CHECK ---
        let isHoldingBall = false;
        if (this.wantsCatch) {
            const bPos = ballBody.getPosition();
            const rPos = this.body.getPosition();
            const dist = Vec2.distance(bPos, rPos);
            
            // Check if ball is close enough to hold
            // Gap must be accounted for: Robot(20) + Ball(10) + Gap(8) = 38 scaled pixels ~ 1.9 meters
            const catchRange = (ROBOT_RADIUS + BALL_RADIUS + 12) / SCALE; 

            if (dist < catchRange) {
                isHoldingBall = true;
            }
        }

        // --- 3. APPLY CARRY PENALTY ---
        if (isHoldingBall) {
            // Apply 10% penalty to WHATEVER the current speed is (Walk or Sprint)
            targetSpeed = targetSpeed * 0.90;
        }

        // --- 4. MOVE ROBOT ---
        let desiredVel = Vec2(0,0);
        if (this.inputVec.length() > 0.1) {
            this.inputVec.normalize();
            desiredVel = Vec2.mul(this.inputVec, targetSpeed);
        }
        
        let smooth = (desiredVel.lengthSquared() > 0.1) ? 0.2 : 0.15;
        this.body.setLinearVelocity(Vec2.add(Vec2.mul(currentVel, 1.0 - smooth), Vec2.mul(desiredVel, smooth)));

        // --- 5. MOVE BALL ---
        if (isHoldingBall) {
            this.applyCatchMechanic();
        }
    }

    applyCatchMechanic() {
        const bPos = ballBody.getPosition();
        const rPos = this.body.getPosition();
        
        // Direction we are moving or facing
        let dir = this.body.getLinearVelocity();
        // If standing still, default to facing goal or current facing (using velocity is simplest approx)
        if (dir.length() < 0.1) {
             dir = Vec2(this.goalTargetX > WIDTH/2 ? 1 : -1, 0);
        }
        dir.normalize();
        
        // CRITICAL GAP: 8 pixels. 
        // This ensures the physics circles never touch, preventing friction drag.
        const gap = 15; 
        const holdDist = (ROBOT_RADIUS + BALL_RADIUS + gap) / SCALE;
        
        const holdPos = Vec2.add(rPos, Vec2.mul(dir, holdDist));
        const pull = Vec2.sub(holdPos, bPos);
        
        // We set the ball velocity directly to the robot's velocity plus a correction vector
        // This creates a stiff spring effect without collision fighting
        const robotVel = this.body.getLinearVelocity();
        
        // (Robot Velocity) + (Correction to Snap Point * Speed)
        ballBody.setLinearVelocity(Vec2.add(robotVel, Vec2.mul(pull, 50.0))); // changed from 10
        ballBody.setAngularVelocity(0);
    }

    runAI(dt) {
        const bPos = ballBody.getPosition();
        const rPos = this.body.getPosition();
        const ballX = bPos.x * SCALE;
        
        const opponent = (this === robot1) ? robot2 : robot1;
        const oppPos = opponent.body.getPosition();
        const oppX = oppPos.x * SCALE;

        let target = bPos; 
        this.wantsSprint = false;
        this.wantsCatch = false;

        let effectiveMode = this.aiType;

        // --- ZONE DEFENSE OVERRIDE ---
        const centerLine = WIDTH / 2;
        const iScoreRight = (this.goalTargetX > WIDTH / 2);
        const inMyHalf = iScoreRight ? (ballX < centerLine) : (ballX > centerLine);
        const oppInMyHalf = iScoreRight ? (oppX < centerLine) : (oppX > centerLine);

        if (this.aiType === "DEFAULT" && inMyHalf && oppInMyHalf) {
            effectiveMode = "DEFENSIVE";
        }

        switch (effectiveMode) {
            case "DEFENSIVE":
                let defenseX = iScoreRight ? 100 : WIDTH - 100;
                let distToDefense = Math.abs(ballX - defenseX);
                
                if (distToDefense < 200) {
                     target = bPos; 
                     this.wantsSprint = true;
                     this.wantsCatch = (Vec2.distance(bPos, rPos) < 4); 
                } else {
                     target = Vec2(defenseX / SCALE, bPos.y);
                }
                break;

            case "AGGRESSIVE":
                target = bPos;
                if (Vec2.distance(bPos, rPos) > 4) this.wantsSprint = true;
                this.wantsCatch = (Vec2.distance(bPos, rPos) < 3);
                break;

            case "CHAOTIC":
                this.randomTimer -= dt;
                if (this.randomTimer <= 0) {
                    this.randomTarget = Vec2(Math.random()*P_WIDTH, Math.random()*P_HEIGHT);
                    this.randomTimer = 0.5 + Math.random();
                }
                target = this.randomTarget;
                if (Math.random() < 0.05) this.wantsCatch = true;
                break;

            case "DEFAULT": 
            default:
                let distToBall = Vec2.distance(rPos, bPos);

                // --- OFFENSIVE DRIBBLING ---
                if (distToBall < 4) {
                    this.wantsCatch = true; 
                    this.wantsSprint = true; 

                    let goalPos = Vec2(this.goalTargetX / SCALE, HEIGHT/2 / SCALE);
                    
                    // EVASION
                    let distToOpp = Vec2.distance(rPos, oppPos);
                    let toGoal = Vec2.sub(goalPos, rPos); toGoal.normalize();
                    let toOpp = Vec2.sub(oppPos, rPos); toOpp.normalize();
                    let dot = Vec2.dot(toGoal, toOpp);

                    if (distToOpp < 10 && dot > 0.5) {
                        let evadeY = (rPos.y > oppPos.y) ? rPos.y + 5 : rPos.y - 5;
                        if (evadeY < 2) evadeY = 5;
                        if (evadeY > P_HEIGHT - 2) evadeY = P_HEIGHT - 5;
                        target = Vec2(this.goalTargetX / SCALE, evadeY);
                    } else {
                        target = goalPos;
                    }

                } else {
                    // --- BALL CHASE ---
                    let vecToGoal = Vec2(this.goalTargetX/SCALE - bPos.x, (HEIGHT/2)/SCALE - bPos.y);
                    vecToGoal.normalize();
                    let behindPos = Vec2.sub(bPos, Vec2.mul(vecToGoal, 1.5)); 
                    target = behindPos;
                    if (distToBall > 10 && this.sprintEnergy > 30) this.wantsSprint = true;
                }
                break;
        }

        const diff = Vec2.sub(target, rPos);
        if (diff.length() > 0.2) this.inputVec = diff;
        else this.inputVec = Vec2(0,0);
    }
}

// --- GAME LOGIC ---
function setupGame(mode) {
    let p1AI = (mode === 'human') ? 'PLAYER' : document.getElementById('selAiBlue').value;
    let p2AI = document.getElementById('selAiGreen').value; 

    // If starting in human mode, default P2 to Player if the dropdown is also set to player (optional)
    // Or just default logic. 
    
    if(ballBody) world.destroyBody(ballBody);
    if(robot1) world.destroyBody(robot1.body);
    if(robot2) world.destroyBody(robot2.body);

    ballBody = world.createBody({
        type: 'dynamic', position: Vec2(P_WIDTH / 2, P_HEIGHT / 2),
        linearDamping: 0.6, angularDamping: 0.8
    });
    ballBody.createFixture(pl.Circle(BALL_RADIUS / SCALE), { 
        density: 0.8, restitution: parseFloat(GAME_CONFIG.ballRestitution), friction: 0.3 
    });

    robot1 = new RobotEntity(150, HEIGHT/2, COLORS.blue, COLORS.blueSide, WIDTH, p1AI);
    robot2 = new RobotEntity(WIDTH - 150, HEIGHT/2, COLORS.green, COLORS.greenSide, 0, p2AI);

    if(currentState === STATE.AUTOBOT || mode === 'auto') {
        robot1.setAI(document.getElementById('selAiBlue').value);
        robot2.setAI(document.getElementById('selAiGreen').value);
    }

    score = { blue: 0, green: 0 };
    startTime = performance.now();
    isPaused = false;
    showHelp = false;
    
    uiMenu.classList.add('hidden');
    uiOptions.classList.add('hidden');
    uiGame.classList.remove('hidden');
    
    currentState = (mode === 'auto') ? STATE.AUTOBOT : STATE.PLAYING;
}

function stopGame() {
    currentState = STATE.MENU;
    uiGame.classList.add('hidden');
    uiMenu.classList.remove('hidden');
    resetIdleTimer();
}

function handleGoal() {
    const bPos = ballBody.getPosition();
    const bx = bPos.x * SCALE;
    
    if (bx < -5 && Math.abs((bPos.y*SCALE) - HEIGHT/2) < GOAL_WIDTH/2 + 20) {
        score.green++; resetBall();
    } else if (bx > WIDTH + 5 && Math.abs((bPos.y*SCALE) - HEIGHT/2) < GOAL_WIDTH/2 + 20) {
        score.blue++; resetBall();
    }
    if (bx < -50 || bx > WIDTH + 50 || bPos.y*SCALE < -50 || bPos.y*SCALE > HEIGHT + 50) {
        resetBall();
    }
}

function resetBall() {
    ballBody.setPosition(Vec2(P_WIDTH/2, P_HEIGHT/2));
    ballBody.setLinearVelocity(Vec2(0,0));
    ballBody.setAngularVelocity(0);
    ballBody.setLinearVelocity(Vec2((Math.random()-0.5)*10, (Math.random()-0.5)*10));
    
    robot1.body.setPosition(Vec2(150/SCALE, HEIGHT/2/SCALE));
    robot1.body.setLinearVelocity(Vec2(0,0));
    robot1.sprintEnergy = 100;

    robot2.body.setPosition(Vec2((WIDTH-150)/SCALE, HEIGHT/2/SCALE));
    robot2.body.setLinearVelocity(Vec2(0,0));
    robot2.sprintEnergy = 100;
}

// --- RENDERING ---
function drawShadow(x, y, r) {
    ctx.beginPath(); ctx.ellipse(x, y, r, r*0.6, 0, 0, Math.PI*2);
    ctx.fillStyle = COLORS.shadow; ctx.fill();
}

function drawCylinder(x, y, r, h, colorTop, colorSide, isSprinting) {
    drawShadow(x, y, r*1.2);
    if (isSprinting) {
        ctx.save(); ctx.globalAlpha = 0.4; ctx.fillStyle = "white";
        ctx.beginPath(); ctx.ellipse(x, y, r*1.4, r*0.7, 0, 0, Math.PI*2); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = colorSide; ctx.fillRect(x-r, y-h, r*2, h);
    ctx.beginPath(); ctx.ellipse(x, y, r, r*0.4, 0, 0, Math.PI, false); ctx.fill(); 
    ctx.beginPath(); ctx.ellipse(x, y-h, r, r*0.4, 0, 0, Math.PI*2); ctx.fillStyle = colorTop; ctx.fill(); ctx.stroke();
}

function drawSphere(x, y, r) {
    drawShadow(x, y+4, r*0.9);
    const drawY = y - r;
    const grad = ctx.createRadialGradient(x-r*0.3, drawY-r*0.3, r*0.2, x, drawY, r);
    grad.addColorStop(0, "#ff8888"); grad.addColorStop(1, "#aa0000");
    ctx.beginPath(); ctx.arc(x, drawY, r, 0, Math.PI*2); ctx.fillStyle = grad; ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.beginPath(); ctx.arc(x-r*0.3, drawY-r*0.3, r*0.2, 0, Math.PI*2); ctx.fill();
}

function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    
    ctx.strokeStyle = (document.body.classList.contains('light-mode')) ? "#ccc" : "#444"; 
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(WIDTH/2, HEIGHT/2, 60, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(WIDTH/2, 0); ctx.lineTo(WIDTH/2, HEIGHT); ctx.stroke();
    
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.fillRect(0, HEIGHT/2 - GOAL_WIDTH/2, GOAL_DEPTH, GOAL_WIDTH);
    ctx.fillRect(WIDTH - GOAL_DEPTH, HEIGHT/2 - GOAL_WIDTH/2, GOAL_DEPTH, GOAL_WIDTH);

    if (robot1 && robot2 && ballBody) {
        const objects = [
            { type: 'ball', y: ballBody.getPosition().y * SCALE, x: ballBody.getPosition().x * SCALE },
            { type: 'robot', obj: robot1, y: robot1.body.getPosition().y * SCALE, x: robot1.body.getPosition().x * SCALE },
            { type: 'robot', obj: robot2, y: robot2.body.getPosition().y * SCALE, x: robot2.body.getPosition().x * SCALE }
        ];
        objects.sort((a, b) => a.y - b.y);

        objects.forEach(o => {
            if (o.type === 'ball') drawSphere(o.x, o.y, BALL_RADIUS);
            else {
                drawCylinder(o.x, o.y, ROBOT_RADIUS, ROBOT_HEIGHT, o.obj.color, o.obj.sideColor, o.obj.isSprinting);
                const vel = o.obj.body.getLinearVelocity();
                if (vel.length() > 0.5) {
                    const angle = Math.atan2(vel.y, vel.x);
                    ctx.save(); ctx.translate(o.x, o.y - ROBOT_HEIGHT); ctx.rotate(angle);
                    ctx.fillStyle = "rgba(255,255,255,0.8)";
                    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(0, 6); ctx.lineTo(0, -6); ctx.fill();
                    ctx.restore();
                }
            }
        });
    }

    if (isPaused && currentState !== STATE.MENU) {
        ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0,0,WIDTH,HEIGHT);
        ctx.textAlign = "center"; 
        
        if(showHelp) {
            ctx.fillStyle = "white";
            ctx.font = "bold 28px Arial"; 
            ctx.fillText("CONTROLS", WIDTH/2, 100);
            
            ctx.font = "20px Arial"; ctx.textAlign = "left"; let y = 160; let x = 150;
            
            ctx.fillStyle = "#2196F3";
            ctx.fillText("PLAYER 1 (Blue):", x, y);
            ctx.fillStyle = "white";
            ctx.fillText("   Move: Arrow Keys", x, y+=30);
            ctx.fillText("   Sprint: N", x, y+=30);
            ctx.fillText("   Catch/Shoot: M", x, y+=30);
            
            y += 50;
            ctx.fillStyle = "#4CAF50";
            ctx.fillText("PLAYER 2 (Green / AI):", x, y);
            ctx.fillStyle = "white";
            ctx.fillText("   Move: W A S D", x, y+=30);
            ctx.fillText("   Sprint: V", x, y+=30);
            ctx.fillText("   Catch/Shoot: B", x, y+=30);

            y = 160; x = 450;
            ctx.fillStyle = "#ffcc00";
            ctx.fillText("SYSTEM:", x, y);
            ctx.fillStyle = "white";
            ctx.fillText("   Pause: P", x, y+=30);
            ctx.fillText("   Toggle Help: H", x, y+=30);
            ctx.fillText("   Cycle AI P1: 1", x, y+=30);
            ctx.fillText("   Cycle AI P2: 2", x, y+=30);
            
            ctx.textAlign = "center";
            ctx.font = "italic 16px Arial";
            ctx.fillText("Press 'H' or 'P' to resume", WIDTH/2, HEIGHT - 80);

        } else {
            ctx.fillStyle = "white";
            ctx.font = "40px Arial";
            ctx.fillText("PAUSED", WIDTH/2, HEIGHT/2 - 20);
            ctx.font = "16px Arial"; 
            ctx.fillText("Press P to Resume | H for Help", WIDTH/2, HEIGHT/2 + 20);
        }
    }
}

function updateUI() {
    if (currentState === STATE.MENU) {
        let remaining = Math.ceil(IDLE_THRESHOLD - menuIdleTime);
        elCountdown.innerText = remaining > 0 ? remaining : "0";
        return;
    }

    elScore.textContent = `Score: Blue ${score.blue} - Green ${score.green}`;
    elTime.textContent = `Time: ${Math.floor((performance.now() - startTime)/1000)}s`;
    
    elSprint1.style.width = robot1.sprintEnergy + "%";
    elStatus1.textContent = `AI: ${robot1.aiType}`;
    
    elSprint2.style.width = robot2.sprintEnergy + "%";
    elStatus2.textContent = `AI: ${robot2.aiType}`;
}

// --- LOOP ---
function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    if (dt > 0.1) dt = 0.1;

    if (currentState === STATE.MENU) {
        if (idleTimerActive) {
            menuIdleTime += dt;
            if (menuIdleTime >= IDLE_THRESHOLD) {
                setupGame('auto'); 
            }
        }
        render(); 
        updateUI();
        return;
    }

    if (!isPaused) {
        // Player 1 Input
        if (robot1.aiType === 'PLAYER') {
            let x = 0, y = 0;
            if (keysPressed['ArrowUp']) y = -1;
            if (keysPressed['ArrowDown']) y = 1;
            if (keysPressed['ArrowLeft']) x = -1;
            if (keysPressed['ArrowRight']) x = 1;
            robot1.inputVec = Vec2(x, y);
            robot1.wantsSprint = !!keysPressed['KeyN'];
            robot1.wantsCatch = !!keysPressed['KeyM'];
        }

        // Player 2 Input
        if (robot2.aiType === 'PLAYER') {
            let x = 0, y = 0;
            if (keysPressed['KeyW']) y = -1;
            if (keysPressed['KeyS']) y = 1;
            if (keysPressed['KeyA']) x = -1;
            if (keysPressed['KeyD']) x = 1;
            robot2.inputVec = Vec2(x, y);
            robot2.wantsSprint = !!keysPressed['KeyV'];
            robot2.wantsCatch = !!keysPressed['KeyB'];
        }

        robot1.update(dt);
        robot2.update(dt);
        world.step(1/60);
        handleGoal();
    }

    render();
    updateUI();
}

// --- EVENT LISTENERS ---
function resetIdleTimer() {
    menuIdleTime = 0;
}
window.addEventListener('mousemove', resetIdleTimer);
window.addEventListener('mousedown', resetIdleTimer);
window.addEventListener('keydown', (e) => {
    resetIdleTimer();
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    if (currentState === STATE.PLAYING || currentState === STATE.AUTOBOT) {
        if(e.code === 'KeyP') isPaused = !isPaused;
        if(e.code === 'KeyH') { showHelp = !showHelp; isPaused = showHelp; }
        if(e.code === 'Digit1') robot1.cycleAI();
        if(e.code === 'Digit2') robot2.cycleAI();
    }
    keysPressed[e.code] = true;
});
window.addEventListener('keyup', (e) => keysPressed[e.code] = false);

document.getElementById('btnStartGame').addEventListener('click', () => setupGame('human'));
document.getElementById('btnAutobot').addEventListener('click', () => setupGame('auto'));
document.getElementById('btnMenuReturn').addEventListener('click', stopGame);

document.getElementById('btnOptions').addEventListener('click', () => {
    idleTimerActive = false;
    uiMenu.classList.add('hidden');
    uiOptions.classList.remove('hidden');
});
document.getElementById('btnCloseOptions').addEventListener('click', () => {
    idleTimerActive = true;
    menuIdleTime = 0;
    uiOptions.classList.add('hidden');
    uiMenu.classList.remove('hidden');
});

function bindSlider(id, configKey, displayId) {
    const slider = document.getElementById(id);
    const display = document.getElementById(displayId);
    slider.addEventListener('input', (e) => {
        GAME_CONFIG[configKey] = parseFloat(e.target.value);
        if(display) display.innerText = e.target.value;
    });
}
bindSlider('slSpeed', 'robotSpeed', 'valSpeed');
bindSlider('slSprint', 'sprintSpeed', 'valSprint');
bindSlider('slBounce', 'ballRestitution', 'valBounce');

const touchButtons = [
    {id:'p1TouchUp', k:'ArrowUp'}, {id:'p1TouchDown', k:'ArrowDown'}, 
    {id:'p1TouchLeft', k:'ArrowLeft'}, {id:'p1TouchRight', k:'ArrowRight'},
    {id:'p1TouchSprint', k:'KeyN'}, {id:'p1TouchCatch', k:'KeyM'}
];
touchButtons.forEach(btn => {
    const el = document.getElementById(btn.id);
    if(el) {
        const press = (e) => { if(e.cancelable) e.preventDefault(); keysPressed[btn.k] = true; resetIdleTimer(); };
        const release = (e) => { if(e.cancelable) e.preventDefault(); keysPressed[btn.k] = false; resetIdleTimer(); };
        el.addEventListener('mousedown', press); el.addEventListener('touchstart', press, {passive:false});
        el.addEventListener('mouseup', release); el.addEventListener('touchend', release, {passive:false});
        el.addEventListener('mouseleave', release);
    }
});

document.getElementById('darkModeToggle').addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
});

initPhysics();
render();
loop();
