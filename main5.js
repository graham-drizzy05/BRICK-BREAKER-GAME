const canvas = document.querySelector(`canvas`);
const gl = canvas.getContext('webgl');

const startScreen = document.getElementById(`startScreen`);
const winScreen = document.getElementById(`winScreen`);
const loseScreen = document.getElementById(`loseScreen`);

const startButton = document.getElementById(`startButton`);
const nextLevelButton = document.getElementById(`nextLevelButton`);
const restartButton = document.getElementById(`restartButton`);

const levelDisplay = document.getElementById(`levelDisplay`);

if (!gl) {
    throw new Error('WEBGL IS NOT SUPPORTED');
}

gl.clearColor(0.0, 0.0, 0.1, 1.0);
gl.clear(gl.COLOR_BUFFER_BIT);

// Shaders
const vs_SOURCE = `
    attribute vec2 a_pos;
    attribute vec4 a_col;
    uniform mat4 u_projectionMatrix;
    varying vec4 vcol;

    void main(void) {
        gl_Position = u_projectionMatrix * vec4(a_pos, 0.0, 1.0);
        vcol = a_col;
    }
`;

const fs_SOURCE = `
    precision mediump float;
    varying vec4 vcol;

    void main(void) {
        gl_FragColor = vcol;
    }
`;

// Shader compilation helper
function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// Program setup
const vsShader = compileShader(gl.VERTEX_SHADER, vs_SOURCE);
const fShader = compileShader(gl.FRAGMENT_SHADER, fs_SOURCE);

const program = gl.createProgram();
gl.attachShader(program, vsShader);
gl.attachShader(program, fShader);
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link failed:', gl.getProgramInfoLog(program));
}

gl.useProgram(program);

// Get locations
const aPos = gl.getAttribLocation(program, 'a_pos');
const aCol = gl.getAttribLocation(program, 'a_col');
const uProjectionMatrix = gl.getUniformLocation(program, 'u_projectionMatrix');

// Enable attributes
gl.enableVertexAttribArray(aPos);
gl.enableVertexAttribArray(aCol);

// Projection matrix
const projectionMatrix = new Float32Array([
    2 / canvas.width, 0, 0, 0,
    0, -2 / canvas.height, 0, 0,
    0, 0, 1, 0,
    -1, 1, 0, 1
]);
gl.uniformMatrix4fv(uProjectionMatrix, false, projectionMatrix);

// Global buffers
const vertexBuffer = gl.createBuffer();
const colorBuffer = gl.createBuffer();

//Game state
let gameStarted = false;
let currentLevel = 1;
let gameLoopId = null;

// Game objects
const paddle = {
    width: 250,
    height: 25,
    x: canvas.width / 2 - 50,
    y: canvas.height - 30,
    speed: 8,
    color: [0.53, 0.81, 0.92, 1.0]
};

const ball = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    radius: 20,
    dx: 4,
    dy: -4,
    color: [1.0, 1.0, 1.0, 1.0]
};

let brickRowCount = 5;
let brickColumnCount = 10;
const brickWidth = 85;
const brickHeight = 30;
const brickPadding = 10;
const brickOffsetTop = 60;
const brickOffsetLeft = 30;
let bricksLeft = 0;
let bricks = [];

function InitializeBricks(){
    bricksLeft = brickRowCount * brickColumnCount;
    bricks = [];

    const hueVariation = (currentLevel * 0.1) % 1;

    for (let c = 0; c < brickColumnCount; c++) {
        bricks[c] = [];
        for (let r = 0; r < brickRowCount; r++) {

            const hue = (hueVariation + (c * 0.02 + r * 0.03)) & 1;
            const saturation = 0.8;
            const lightness = 0.6;

            const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
            const p = 2 * lightness - q;

            const rgb = [ 
                hueToRGB(p, q, hue + 1/3),
                hueToRGB(p, q, hue), 
                hueToRGB(p, q, hue - 1/3)
            ];
            bricks[c][r] = { 
                x: 0, 
                y: 0, 
                status: 1,
                color: [rgb[0], rgb[1], rgb[2], 1.0] // << use the same color for all bricks
            };
        }
    }

}

function hueToRGB(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
}

// Input
let rightPressed = false;
let leftPressed = false;

document.addEventListener('keydown', keyDownHandler);
document.addEventListener('keyup', keyUpHandler);

function keyDownHandler(e) {
    if (!gameStarted) return;
    
    if (e.key === 'Right' || e.key === 'ArrowRight'){
        rightPressed = true;
    }
    else if (e.key === 'Left' || e.key === 'ArrowLeft') {
        leftPressed = true;
    }
}

function keyUpHandler(e) {
    if (e.key === 'Right' || e.key === 'ArrowRight') {
        rightPressed = false;
    }
    else if (e.key === 'Left' || e.key === 'ArrowLeft') {
        leftPressed = false;
    }
}

// Collision detection
function collisionDetection() {
    for (let c = 0; c < brickColumnCount; c++) {
        for (let r = 0; r < brickRowCount; r++) {
            const brick = bricks[c][r];
            if (brick.status === 1) {
                if (
                    ball.x > brick.x &&
                    ball.x < brick.x + brickWidth &&
                    ball.y > brick.y &&
                    ball.y < brick.y + brickHeight
                ) {
                    ball.dy = -ball.dy;
                    brick.status = 0;
                    bricksLeft--;

                    if (bricksLeft <= 0) {
                        levelComplete();
                    }
                }
            }
        }
    }
}

// Draw functions
function drawRectangle(x, y, width, height, color) {
    const vertices = [
        x, y,
        x + width, y,
        x, y + height,
        x + width, y + height
    ];

    const colors = [];
    for (let i = 0; i < 4; i++) {
        colors.push(...color);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function drawCircle(x, y, radius, color) {
    const segments = 20;
    const vertices = [x, y];
    const colors = [...color];

    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        vertices.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        colors.push(...color);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_FAN, 0, segments + 2);
}

function drawBricks() {
    for (let c = 0; c < brickColumnCount; c++) {
        for (let r = 0; r < brickRowCount; r++) {
            const brick = bricks[c][r];
            if (brick.status === 1) {
                const brickX = c * (brickWidth + brickPadding) + brickOffsetLeft;
                const brickY = r * (brickHeight + brickPadding) + brickOffsetTop;
                brick.x = brickX;
                brick.y = brickY;

                drawRectangle(brickX, brickY, brickWidth, brickHeight, brick.color);
            }
        }
    }
}

// Reset ball and paddle position
function resetBallAndPaddle() {
    ball.x = canvas.width / 2;
    ball.y = canvas.height / 2;
    ball.dx = 4 + (currentLevel * 0.5);
    ball.dy = -4 - (currentLevel * 0.5);
    paddle.x = canvas.width / 2 - paddle.width / 2;
    paddle.y = canvas.height - 30;
}

// Show start screen
function showStartScreen() {
    startScreen.style.display = 'flex';
    winScreen.style.display = 'none';
    loseScreen.style.display = 'none';
}
// Show win screen
function showWinScreen() {
    startScreen.style.display = 'none';
    winScreen.style.display = 'flex';
    loseScreen.style.display = 'none';
}

// Show lose screen
function showLoseScreen() {
    startScreen.style.display = 'none';
    winScreen.style.display = 'none';
    loseScreen.style.display = 'flex';
}

// Start the game
function startGame() {
    gameStarted = true;
    currentLevel = 1;
    setupLevel();
    startScreen.style.display = 'none';
    gameLoopId = requestAnimationFrame(gameLoop);
}

// Level complete
function levelComplete() {
    gameStarted = false;
    cancelAnimationFrame(gameLoopId);
    showWinScreen();
}

// Game over
function gameOver() {
    gameStarted = false;
    cancelAnimationFrame(gameLoopId);
    showLoseScreen();
}

// Setup level with increasing difficulty
function setupLevel() {
    // Increase difficulty with each level
    brickRowCount = 5 + Math.floor(currentLevel / 2);
    brickColumnCount = 10 + Math.floor(currentLevel / 3);
            
    // Update level display
    levelDisplay.textContent = `Level: ${currentLevel}`;
            
    InitializeBricks();
    resetBallAndPaddle();
}

// Next level
function nextLevel() {
    currentLevel++;
    gameStarted = true;
    setupLevel();
    winScreen.style.display = 'none';
    gameLoopId = requestAnimationFrame(gameLoop);
}

// Restart game
function restartGame() {
    currentLevel = 1;
    gameStarted = true;
    setupLevel();
    loseScreen.style.display = 'none';
    gameLoopId = requestAnimationFrame(gameLoop);
}

// Game loop
function gameLoop() {
    gl.clear(gl.COLOR_BUFFER_BIT);

    drawBricks();
    drawRectangle(paddle.x, paddle.y, paddle.width, paddle.height, paddle.color);
    drawCircle(ball.x, ball.y, ball.radius, ball.color);

    collisionDetection();

    ball.x += ball.dx;
    ball.y += ball.dy;

    // Wall collision
    if (ball.x + ball.radius > canvas.width || ball.x - ball.radius < 0) {
        ball.dx = -ball.dx;
    }
    if (ball.y - ball.radius < 0) {
        ball.dy = -ball.dy;
    }

    // Paddle collision
    if (
        ball.y + ball.radius > paddle.y &&
        ball.x > paddle.x &&
        ball.x < paddle.x + paddle.width
        ) {
            ball.dy = -ball.dy;

            const hit = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
            ball.dx = hit * (6 + currentLevel * 0.5); // Increase angle with level
        }

    // Game over (ball out of bottom)
    if (ball.y + ball.dy > canvas.height + ball.radius) {
        gameOver();
        return;
    }

    // Paddle movement
    if (rightPressed && paddle.x < canvas.width - paddle.width) {
        paddle.x += paddle.speed;
    } else if (leftPressed && paddle.x > 0) {
        paddle.x -= paddle.speed;
    }

    gameLoopId = requestAnimationFrame(gameLoop);
}

// Event listeners for UI buttons
startButton.addEventListener('click', startGame);
nextLevelButton.addEventListener('click', nextLevel);
restartButton.addEventListener('click', restartGame);

// Show start screen initially
showStartScreen();