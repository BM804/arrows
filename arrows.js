(function(){
  const ROWS = 8, COLS = 6;
  const MAX_LIVES = 3;
  const DIRS = {
    up:    { dr:-1, dc:0 },
    down:  { dr:1,  dc:0 },
    left:  { dr:0,  dc:-1 },
    right: { dr:0,  dc:1 }
  };
  const DIR_NAMES = Object.keys(DIRS);
  const REVERSE = { up:'down', down:'up', left:'right', right:'left' };

  let level = 1, score = 0, lives = MAX_LIVES;
  let owner = [];          // ROWS x COLS -> snake id or null
  let snakes = {};         // id -> { id, cells:[{r,c}...tail..head], dir, groupEl, shaftEl, headEl }
  let nextId = 1;
  let animating = new Set();
  let cellEls = [];        // ROWS x COLS -> DOM cell
  let stepPx = { x: 0, y: 0 };

  const boardEl = document.getElementById('board');
  const overlayEl = document.getElementById('overlay');
  const cardTitle = document.getElementById('card-title');
  const cardSub = document.getElementById('card-sub');
  const cardNum = document.getElementById('card-num');
  const cardBtn = document.getElementById('card-btn');
  const livesEl = document.getElementById('lives');
  const statLevel = document.getElementById('stat-level');
  const statRemaining = document.getElementById('stat-remaining');
  const statScore = document.getElementById('stat-score');

  const svgNS = 'http://www.w3.org/2000/svg';
  let svgOverlay = null;

  function key(r,c){ return r + '-' + c; }
  function inBounds(r,c){ return r>=0 && r<ROWS && c>=0 && c<COLS; }

  function shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
  }
  function randInt(min,max){ return min + Math.floor(Math.random()*(max-min+1)); }

  function getPath(r,c,dir){
    const {dr,dc} = DIRS[dir];
    const path = [];
    let nr = r+dr, nc = c+dc;
    while(inBounds(nr,nc)){
      path.push({r:nr,c:nc});
      nr+=dr; nc+=dc;
    }
    return path;
  }

  function makeOwnerGrid(){
    const g = [];
    for(let r=0;r<ROWS;r++) g.push(new Array(COLS).fill(null));
    return g;
  }

  function generateSnakes(lvl){
    const lenMin = Math.min(3 + Math.floor(lvl/6), 4);
    const lenMax = Math.min(lenMin + 2, 6);
    const targetCount = Math.min(5 + Math.floor((lvl-1)*0.9), 12);

    const grid = makeOwnerGrid();
    const result = [];
    let id = 1;
    let attempts = 0;
    const maxAttempts = targetCount * 90;

    while(result.length < targetCount && attempts < maxAttempts){
      attempts++;
      const sr = Math.floor(Math.random()*ROWS);
      const sc = Math.floor(Math.random()*COLS);
      if(grid[sr][sc] !== null) continue;

      const desiredLen = randInt(lenMin, lenMax);
      const path = [{r:sr, c:sc}];
      let lastDir = null;
      const inPath = (r,c)=> path.some(p=>p.r===r && p.c===c);

      for(let step=1; step<desiredLen; step++){
        const cur = path[path.length-1];
        const options = shuffle(DIR_NAMES.slice()).filter(d => d !== (lastDir ? REVERSE[lastDir] : null));
        let placed = false;
        for(const d of options){
          const {dr,dc} = DIRS[d];
          const nr = cur.r+dr, nc = cur.c+dc;
          if(!inBounds(nr,nc)) continue;
          if(grid[nr][nc] !== null) continue;
          if(inPath(nr,nc)) continue;
          path.push({r:nr,c:nc});
          lastDir = d;
          placed = true;
          break;
        }
        if(!placed) break;
      }

      if(path.length < 2){
        // fall back to a single-cell piece with a random direction
        const dirs = shuffle(DIR_NAMES.slice());
        let chosen = null;
        for(const d of dirs){
          const exitPath = getPath(sr,sc,d);
          if(exitPath.every(p => grid[p.r][p.c] === null)){ chosen = d; break; }
        }
        if(!chosen) continue;
        lastDir = chosen;
      } else {
        // verify runway past the head is clear; if not, try trimming length back
        let ok = false;
        while(path.length >= 2){
          const head = path[path.length-1];
          const exitPath = getPath(head.r, head.c, lastDir);
          const blocked = exitPath.some(p => grid[p.r][p.c] !== null);
          if(!blocked){ ok = true; break; }
          // trim the last cell and recompute lastDir from the new tail
          path.pop();
          if(path.length < 2) break;
          const a = path[path.length-2], b = path[path.length-1];
          for(const d of DIR_NAMES){
            if(a.r+DIRS[d].dr === b.r && a.c+DIRS[d].dc === b.c){ lastDir = d; break; }
          }
        }
        if(!ok || path.length < 1) continue;
      }

      // commit
      path.forEach(p => { grid[p.r][p.c] = id; });
      result.push({ id, cells: path.slice(), dir: lastDir });
      id++;
    }

    return { grid, snakeList: result, nextId: id };
  }

  function buildLevel(lvl){
    boardEl.innerHTML = '';
    snakes = {};
    animating.clear();
    cellEls = [];

    const { grid, snakeList, nextId: nid } = generateSnakes(lvl);
    owner = grid;
    nextId = nid;

    for(let r=0;r<ROWS;r++){
      const row = [];
      for(let c=0;c<COLS;c++){
        const cell = document.createElement('div');
        const isOcc = owner[r][c] !== null;
        cell.className = isOcc ? 'cell piece' : 'cell empty';
        cell.dataset.r = r; cell.dataset.c = c;
        boardEl.appendChild(cell);
        row.push(cell);
      }
      cellEls.push(row);
    }

    // build svg overlay after layout so we can measure real cell geometry
    requestAnimationFrame(()=>{
      layoutOverlay(snakeList);
      updateHUD();
    });
  }

  function layoutOverlay(snakeList){
    if(svgOverlay) svgOverlay.remove();

    const boardRect = boardEl.getBoundingClientRect();
    const c0 = cellEls[0][0].getBoundingClientRect();
    const c1 = COLS>1 ? cellEls[0][1].getBoundingClientRect() : c0;
    const r1 = ROWS>1 ? cellEls[1][0].getBoundingClientRect() : c0;
    stepPx = {
      x: COLS>1 ? (c1.left - c0.left) : c0.width,
      y: ROWS>1 ? (r1.top - c0.top) : c0.height
    };
    const cellW = c0.width, cellH = c0.height;
    const innerW = boardRect.width - 24; // minus 12px padding each side
    const innerH = boardRect.height - 24;

    svgOverlay = document.createElementNS(svgNS,'svg');
    svgOverlay.setAttribute('class','overlay-svg');
    svgOverlay.setAttribute('width', innerW);
    svgOverlay.setAttribute('height', innerH);
    svgOverlay.setAttribute('viewBox', `0 0 ${innerW} ${innerH}`);
    boardEl.appendChild(svgOverlay);

    function centerOf(r,c){
      const rect = cellEls[r][c].getBoundingClientRect();
      return {
        x: rect.left - boardRect.left - 12 + rect.width/2,
        y: rect.top - boardRect.top - 12 + rect.height/2
      };
    }

    const stepAvg = (cellW + cellH)/2;
    const strokeW = stepAvg * 0.16;

    snakeList.forEach(s => {
      const g = document.createElementNS(svgNS,'g');
      g.setAttribute('class','snake-group');
      g.dataset.id = s.id;

      const pts = s.cells.map(p => centerOf(p.r,p.c));
      const dstr = pts.map((p,i)=> (i===0?'M':'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');

      const shaft = document.createElementNS(svgNS,'path');
      shaft.setAttribute('class','snake-shaft');
      shaft.setAttribute('d', dstr);
      shaft.setAttribute('stroke-width', strokeW.toFixed(1));
      g.appendChild(shaft);

      const head = pts[pts.length-1];
      const {dr,dc} = DIRS[s.dir];
      const dx = dc, dy = dr; // unit-ish (grid dirs are already unit vectors)
      const rx = -dy, ry = dx; // perpendicular
      const tipLen = stepAvg * 0.42;
      const baseOff = stepAvg * 0.06;
      const halfW = stepAvg * 0.24;

      const tip = { x: head.x + dx*tipLen, y: head.y + dy*tipLen };
      const baseC = { x: head.x + dx*baseOff, y: head.y + dy*baseOff };
      const baseA = { x: baseC.x + rx*halfW, y: baseC.y + ry*halfW };
      const baseB = { x: baseC.x - rx*halfW, y: baseC.y - ry*halfW };

      const headPoly = document.createElementNS(svgNS,'polygon');
      headPoly.setAttribute('class','snake-head');
      headPoly.setAttribute('points', `${baseA.x.toFixed(1)},${baseA.y.toFixed(1)} ${baseB.x.toFixed(1)},${baseB.y.toFixed(1)} ${tip.x.toFixed(1)},${tip.y.toFixed(1)}`);
      g.appendChild(headPoly);

      svgOverlay.appendChild(g);

      s.groupEl = g;
      s.shaftEl = shaft;
      s.headEl = headPoly;
      snakes[s.id] = s;
    });
  }

  function updateHUD(){
    statLevel.textContent = String(level).padStart(2,'0');
    statScore.textContent = score;
    statRemaining.textContent = Object.keys(snakes).length;
    livesEl.innerHTML = '';
    for(let i=0;i<MAX_LIVES;i++){
      const d = document.createElement('div');
      d.className = 'life-icon' + (i < lives ? '' : ' lost');
      livesEl.appendChild(d);
    }
  }

  function easeOutCubic(t){ return 1 - Math.pow(1-t, 3); }
  function easeInCubic(t){ return t*t*t; }

  // Manually interpolates the group's transform/opacity every frame via rAF.
  // (CSS transitions on an SVG <g>'s transform don't animate reliably in
  // every renderer, so we drive this ourselves instead.)
  function animateGroup(g, fromX, fromY, toX, toY, fromOp, toOp, duration, ease, onDone){
    const start = performance.now();
    function frame(now){
      const t = Math.min(1, (now-start)/duration);
      const e = ease(t);
      const x = fromX + (toX-fromX)*e;
      const y = fromY + (toY-fromY)*e;
      g.setAttribute('transform', `translate(${x},${y})`);
      if(fromOp !== null && toOp !== null){
        g.style.opacity = String(fromOp + (toOp-fromOp)*e);
      }
      if(t < 1){ requestAnimationFrame(frame); }
      else if(onDone){ onDone(); }
    }
    requestAnimationFrame(frame);
  }

  function onCellTap(cellEl){
    const r = +cellEl.dataset.r, c = +cellEl.dataset.c;
    const id = owner[r][c];
    if(id === null) return;
    const s = snakes[id];
    if(!s || animating.has(id)) return;

    const head = s.cells[s.cells.length-1];
    const exitPath = getPath(head.r, head.c, s.dir);
    const blocked = exitPath.some(p => owner[p.r][p.c] !== null);

    if(!blocked){
      animating.add(id);
      const {dr,dc} = DIRS[s.dir];
      const travelSteps = s.cells.length + exitPath.length + 1;
      const tx = dc * travelSteps * stepPx.x;
      const ty = dr * travelSteps * stepPx.y;
      animateGroup(s.groupEl, 0, 0, tx, ty, 1, 0, 380, easeOutCubic, ()=>{
        s.cells.forEach(p => { owner[p.r][p.c] = null; cellEls[p.r][p.c].className = 'cell empty'; });
        s.groupEl.remove();
        delete snakes[id];
        animating.delete(id);
        score += s.cells.length * 10;
        updateHUD();
        checkWin();
      });
    } else {
      animating.add(id);
      s.groupEl.classList.add('blocked');
      const {dr,dc} = DIRS[s.dir];
      const bumpDx = dc * stepPx.x * 0.28;
      const bumpDy = dr * stepPx.y * 0.28;
      animateGroup(s.groupEl, 0, 0, bumpDx, bumpDy, null, null, 130, easeOutCubic, ()=>{
        animateGroup(s.groupEl, bumpDx, bumpDy, 0, 0, null, null, 220, easeInCubic, ()=>{
          s.groupEl.classList.remove('blocked');
          animating.delete(id);
        });
      });
      loseLife();
    }
  }

  function loseLife(){
    lives--;
    updateHUD();
    if(lives <= 0){
      setTimeout(gameOver, 260);
    }
  }

  function checkWin(){
    if(Object.keys(snakes).length === 0){
      setTimeout(levelComplete, 150);
    }
  }

  function showOverlay(title, sub, num, btnLabel, onClick){
    cardTitle.textContent = title;
    cardSub.textContent = sub;
    if(num !== null){
      cardNum.style.display = 'block';
      cardNum.textContent = num;
    } else {
      cardNum.style.display = 'none';
    }
    cardBtn.textContent = btnLabel;
    overlayEl.classList.add('visible');
    cardBtn.onclick = ()=>{
      overlayEl.classList.remove('visible');
      onClick();
    };
  }

  function levelComplete(){
    showOverlay(
      'Level ' + level + ' cleared',
      'Board fully cleared with ' + lives + ' ' + (lives===1?'life':'lives') + ' left. Next board adds more paths.',
      score,
      'Next level',
      ()=>{ level++; buildLevel(level); }
    );
  }

  function gameOver(){
    showOverlay(
      'Board jammed',
      'You ran out of lives. Every board is solvable — look for a path with a clear runway before you tap.',
      score,
      'Try again',
      ()=>{ level=1; score=0; lives=MAX_LIVES; buildLevel(level); }
    );
  }

  boardEl.addEventListener('click', (e)=>{
    const cell = e.target.closest('.cell.piece');
    if(cell) onCellTap(cell);
  });

  showOverlay('Arrows', 'Clear every path off the board without a single collision. Boards get denser as you go.', null, 'Play', ()=>{
    buildLevel(level);
  });
})();