(function () {
    'use strict';
    const CONFIG = {
        quickInterval: 3000,
        watchInterval: 60000,
        backoffSteps: [3, 5, 10, 30],
    };
    const state = {
        running: false,
        mode: 'quick',
        lessonMap: {},
        countMap: {},
        targets: [],
        successes: {},
        failStreak: 0,
        profileId: null,
        base: '/eams',
    };
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
    async function getJSON(url) {
        const r = await fetch(url, { credentials: 'include' });
        const t = await r.text();
        return t;
    }
    function parseJSLiteral(str) {
        let pos = 0;
        function ws() { while (pos < str.length && /\s/.test(str[pos])) pos++; }
        function parseValue() {
            ws();
            if (pos >= str.length) throw new Error('Unexpected end');
            const c = str[pos];
            if (c === '{') return parseObject();
            if (c === '[') return parseArray();
            if (c === "'" || c === '"') return parseString();
            if (c === 't') { expect('true'); return true; }
            if (c === 'f') { expect('false'); return false; }
            if (c === 'n') { expect('null'); return null; }
            const m = str.slice(pos).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/);
            if (m) { pos += m[0].length; return parseFloat(m[0]); }
            throw new Error('Unexpected char at ' + pos + ': ' + c);
        }
        function expect(word) {
            if (str.slice(pos, pos + word.length) === word) { pos += word.length; return; }
            throw new Error('Expected ' + word + ' at ' + pos);
        }
        function parseString() {
            const quote = str[pos++];
            let out = '';
            while (pos < str.length) {
                const c = str[pos++];
                if (c === quote) return out;
                if (c === '\\') {
                    const n = str[pos++];
                    if (n === 'n') out += '\n';
                    else if (n === 't') out += '\t';
                    else if (n === 'r') out += '\r';
                    else if (n === 'u') { out += String.fromCharCode(parseInt(str.slice(pos, pos + 4), 16)); pos += 4; }
                    else out += n;
                } else {
                    out += c;
                }
            }
            throw new Error('Unterminated string');
        }
        function parseObject() {
            pos++;
            ws();
            const obj = {};
            if (str[pos] === '}') { pos++; return obj; }
            while (true) {
                ws();
                let key;
                if (str[pos] === "'" || str[pos] === '"') {
                    key = parseString();
                } else {
                    const km = str.slice(pos).match(/^[A-Za-z_][A-Za-z0-9_]*/);
                    if (!km) throw new Error('Bad key at ' + pos);
                    key = km[0];
                    pos += km[0].length;
                }
                ws();
                if (str[pos] !== ':') throw new Error('Expected : at ' + pos);
                pos++;
                const val = parseValue();
                obj[key] = val;
                ws();
                if (str[pos] === ',') { pos++; continue; }
                if (str[pos] === '}') { pos++; return obj; }
                throw new Error('Expected , or } at ' + pos);
            }
        }
        function parseArray() {
            pos++;
            ws();
            const arr = [];
            if (str[pos] === ']') { pos++; return arr; }
            while (true) {
                arr.push(parseValue());
                ws();
                if (str[pos] === ',') { pos++; continue; }
                if (str[pos] === ']') { pos++; return arr; }
                throw new Error('Expected , or ] at ' + pos);
            }
        }
        return parseValue();
    }
    function detectProfile() {
        const m = location.href.match(/electionProfile\.id=(\d+)/) ||
                 location.href.match(/profileId=(\d+)/);
        if (m) { state.profileId = m[1]; return; }
        if (window.electCourseTable && window.electCourseTable.config) {
            state.profileId = window.electCourseTable.config.profileId;
            state.base = window.electCourseTable.config.base || '/eams';
        }
    }
    async function fetchLessons() {
        if (!state.profileId) return false;
        const t = await getJSON(state.base + '/stdElectCourse!data.action?profileId=' + state.profileId);
        const idx = t.indexOf('lessonJSONs');
        if (idx < 0) return false;
        const after = t.slice(idx + 'lessonJSONs'.length).replace(/^\s*=\s*/, '');
        let depth = 0, end = -1;
        for (let i = 0; i < after.length; i++) {
            const ch = after[i];
            if (ch === '[') depth++;
            else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end < 0) return false;
        let arr = null;
        try {
            arr = parseJSLiteral(after.slice(0, end + 1));
        } catch (e) {
            console.error('解析课程数据失败', e);
            return false;
        }
        if (!Array.isArray(arr)) return false;
        state.lessonMap = {};
        arr.forEach(l => { state.lessonMap[l.id] = l; });
        return arr;
    }
    async function fetchCounts() {
        let projectId = 1, semesterId = 262;
        if (window.electCourseTable && window.electCourseTable.config) {
            if (window.electCourseTable.config.projectId) projectId = window.electCourseTable.config.projectId;
            if (window.electCourseTable.config.semesterId) semesterId = window.electCourseTable.config.semesterId;
        }
        const pm = document.body.innerHTML.match(/projectId["']?\s*[:=]\s*["']?(\d+)/);
        const sm = document.body.innerHTML.match(/semesterId["']?\s*[:=]\s*["']?(\d+)/);
        if (pm) projectId = pm[1];
        if (sm) semesterId = sm[1];
        try {
            const t = await getJSON(state.base + '/stdElectCourse!queryStdCount.action?projectId=' + projectId + '&semesterId=' + semesterId);
            // 形如: window.lessonId2Counts={'406307':{sc:0,lc:25},...} (可能无结尾分号，对象很大)
            const idx = t.indexOf('lessonId2Counts');
            if (idx >= 0) {
                let seg = t.slice(idx + 'lessonId2Counts'.length).replace(/^\s*=\s*/, '');
                const endIdx = seg.search(/;\s*(window\.)?\w+\s*=|;\s*$/);
                if (endIdx >= 0) seg = seg.slice(0, endIdx);
                seg = seg.trim();
                if (seg.length > 0) {
                    state.countMap = parseJSLiteral(seg);
                }
            }
        } catch (e) { /* 忽略 */ }
    }
    // 执行选课提交，返回 {ok, msg}
    function doElectXHR(lessonId) {
        const profileId = state.profileId;
        const body = 'optype=true&operator0=' + lessonId + ':true&lesson0=' + lessonId +
            '&schLessonGroup_' + lessonId + '=0&retakeDetail=';
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', state.base + '/stdElectCourse!batchOperator.action?profileId=' + profileId + '&retakeDetail=', true);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
            xhr.timeout = 15000;
            xhr.onload = function () {
                resolve({ html: xhr.responseText || '', finalUrl: xhr.responseURL });
            };
            xhr.ontimeout = function () { resolve({ html: '', finalUrl: '', timeout: true }); };
            xhr.onerror = function () { resolve({ html: '', finalUrl: '', error: true }); };
            xhr.send(body);
        });
    }
    // 解析提交结果
    function parseResult(html) {
        const clean = (html || '').replace(/<script[\s\S]*?<\/script>/g, ' ')
            .replace(/<style[\s\S]*?<\/style>/g, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        // 形如: 课程名[课程序号]选课 成功 或 课程名[课程序号]选课 失败:原因
        const m = clean.match(/([\s\S]*?)\[([^\]]+)\]\s*选课\s*(成功|失败[：:]?\s*[^\s]+(?:[^\n]*?)(?=选课|$))/);
        if (m) {
            const ok = m[3].indexOf('成功') === 0;
            return { ok, msg: ok ? '选课成功' : m[3].replace(/^失败[：:]\s*/, ''), isResult: true };
        }
        if (/选课\s*成功/.test(clean)) return { ok: true, msg: '选课成功', isResult: true };
        if (/选课\s*失败/.test(clean)) {
            const fm = clean.match(/选课\s*失败[：:]?\s*([^\s]+(?:[^\n]*?)(?=选课|$))/);
            return { ok: false, msg: fm ? fm[1] : '选课失败', isResult: true };
        }
        // 检测是否被重定向到选课首页（页面状态异常）
        if (clean.indexOf('选课轮次') >= 0 && clean.indexOf('innerIndex') >= 0) {
            return { ok: false, msg: '页面状态异常(被重定向首页)，需刷新', isResult: false, needReload: true };
        }
        if (clean.indexOf('选课轮次') >= 0) {
            return { ok: false, msg: '未执行选课(跳回首页)', isResult: false, needReload: true };
        }
        return { ok: false, msg: '未知返回', isResult: false };
    }
    async function doElect(lessonId) {
        const res = await doElectXHR(lessonId);
        if (res.timeout) return { ok: false, msg: '请求超时' };
        if (res.error) return { ok: false, msg: '网络错误' };
        return parseResult(res.html);
    }
    // 抢课逻辑
    async function tryTarget(target) {
        // 找出匹配的课程
        const matched = [];
        Object.values(state.lessonMap).forEach(l => {
            if (target.type === 'id' && String(l.id) === String(target.value)) matched.push(l);
            else if (target.type === 'code' && l.code === target.value) matched.push(l);
            else if (target.type === 'no' && l.no === target.value) matched.push(l);
            else if (target.type === 'name' && (l.name === target.value || l.name.indexOf(target.value) >= 0)) matched.push(l);
        });
        if (matched.length === 0) return { ok: false, msg: '未找到匹配课程', full: false };
        // 按优先级：目标顺序即优先级，全部试一遍
        let allFull = true;
        for (const lesson of matched) {
            const id = lesson.id;
            if (state.successes[id]) return { ok: true, msg: '已抢到(之前成功)' };
            const name = lesson.name || '';
            const no = lesson.no || '';
            // 无论是否满员都提交，让服务器返回明确结果（这样每次都有真实反馈）
            const cnt = state.countMap[id];
            const isFull = cnt && cnt.sc >= cnt.lc;
            const res = await doElect(id);
            if (res.ok) {
                state.successes[id] = true;
                state.failStreak = 0;
                reportAttempt({ ok: true, type: 'success', text: '✅ 抢到 ' + name + '[' + no + ']' });
                return { ok: true, msg: '抢到 ' + name + '[' + no + ']' };
            }
            // 页面状态异常：需要刷新页面后继续
            if (res.needReload) return { ok: false, msg: res.msg, full: false, needReload: true };
            // 失败原因分类
            const msg = res.msg || '';
            if (msg.indexOf('已选') >= 0 || msg.indexOf('选过') >= 0) {
                state.successes[id] = true;
                reportAttempt({ ok: true, type: 'info', text: 'ℹ️ 已选过 ' + name + '[' + no + ']' });
                return { ok: true, msg: '已选过 ' + name + '[' + no + ']' };
            }
            if (msg.indexOf('冲突') >= 0) {
                reportAttempt({ ok: false, type: 'fail', text: '❌ ' + name + '[' + no + '] 时间冲突' });
                return { ok: false, msg: '时间冲突: ' + msg, full: false };
            }
            if (msg.indexOf('满') >= 0) {
                state.failStreak++;
                allFull = allFull && true;
                reportAttempt({ ok: false, type: 'full', text: '⛔ ' + name + '[' + no + '] 人数已满: ' + msg });
                continue; // 满员，试下一门
            }
            // 其他失败
            state.failStreak++;
            allFull = false;
            reportAttempt({ ok: false, type: 'fail', text: '❌ ' + name + '[' + no + '] 失败: ' + msg });
        }
        if (allFull) return { ok: false, msg: '所有目标均满员', full: true };
        return { ok: false, msg: '所有目标均未成功', full: false };
    }
    // 报告每次提交结果：更新"最近结果"大字显示 + 写日志 + 浮动提示
    function reportAttempt(r) {
        const el = $('#grabber-last');
        if (el) {
            el.style.display = 'block';
            el.textContent = r.text + '  (' + new Date().toLocaleTimeString() + ')';
            // 类型配色: success绿 / fail红 / full橙 / info蓝
            const colors = { success: '#16a34a', fail: '#dc2626', full: '#f59e0b', info: '#1a56db' };
            el.style.background = colors[r.type] || '#1a56db';
        }
        // 日志总是记录完整
        log(r.text);
        // 成功/已选过 → 响铃+浮动提示；失败/满员 → 只写日志和面板（避免弹窗轰炸）
        if (r.type === 'success') {
            notify('抢课成功', r.text);
        } else if (r.type === 'info') {
            notify('已选过', r.text);
        }
    }
    async function runOnce() {
        if (!state.profileId) detectProfile();
        if (!state.lessonMap || Object.keys(state.lessonMap).length === 0) {
            await fetchLessons();
        }
        await fetchCounts();
        if (state.targets.length === 0) { log('未设置目标课程'); return; }
        let allFull = true;
        let needReload = false;
        for (const t of state.targets) {
            const res = await tryTarget(t);
            if (res.ok) {
                // reportAttempt 已处理通知，这里只需停止
                renderLessons();
                stopGrab();
                return;
            }
            log('[' + (t.type + ':' + t.value) + '] ' + res.msg);
            allFull = allFull && res.full;
            if (res.needReload) needReload = true;
        }
        if (needReload) {
            // 页面状态异常：等待几秒后自动刷新页面（油猴在刷新后会自动重跑）
            log('检测到页面状态异常，5秒后自动刷新页面...');
            setTimeout(() => { location.reload(); }, 5000);
            state.running = false;
            return;
        }
        // 全部失败：按模式调度
        if (state.mode === 'quick') {
            if (allFull) {
                // 满员：自动切换到蹲守模式，降频防封
                log('所有目标满员，自动切换蹲守模式（' + CONFIG.watchInterval / 1000 + 's 一次）');
                setMode('watch');
                scheduleNext(CONFIG.watchInterval);
            } else {
                const backoff = CONFIG.backoffSteps[Math.min(state.failStreak, CONFIG.backoffSteps.length - 1)] * 1000;
                log('本轮未成功，退避 ' + backoff / 1000 + 's 后重试');
                scheduleNext(backoff);
            }
        } else {
            // 蹲守模式：慢速轮询，满员期间保持低频
            log('蹲守中，' + CONFIG.watchInterval / 1000 + 's 后重试');
            scheduleNext(CONFIG.watchInterval);
        }
    }
    // ==================== 调度 ====================
    let timer = null;
    function scheduleNext(delay) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { if (state.running) runOnce(); }, delay);
    }
    // ==================== UI ====================
    function buildUI() {
        if ($('#grabber-root')) return;
        const root = document.createElement('div');
        root.id = 'grabber-root';
        root.innerHTML = `
<style>
#grabber-root{position:fixed;top:10px;right:10px;width:430px;max-height:90vh;overflow:auto;z-index:99999;
background:#fff;border:1px solid #ccc;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.3);
font-family:"Microsoft YaHei",sans-serif;font-size:13px;color:#333;padding:12px}
#grabber-root *{box-sizing:border-box}
#grabber-root h3{margin:0 0 10px;font-size:15px;color:#1a56db}
#grabber-root .row{margin-bottom:8px}
#grabber-root input,#grabber-root select{width:100%;padding:5px 8px;border:1px solid #bbb;border-radius:5px;font-size:13px}
#grabber-root button{padding:6px 12px;border:none;border-radius:5px;cursor:pointer;font-size:13px}
#grabber-root .btn-primary{background:#1a56db;color:#fff}
#grabber-root .btn-success{background:#16a34a;color:#fff}
#grabber-root .btn-danger{background:#dc2626;color:#fff}
#grabber-root .btn-ghost{background:#e5e7eb;color:#333}
#grabber-root .btn-sm{padding:2px 8px;font-size:12px}
#grabber-root .target-item{display:flex;align-items:center;gap:6px;background:#f3f4f6;border-radius:5px;padding:4px 8px;margin-bottom:4px}
#grabber-root .target-item .tag{background:#1a56db;color:#fff;border-radius:3px;padding:1px 6px;font-size:11px}
#grabber-root .target-item .del{cursor:pointer;color:#dc2626;font-weight:bold}
#grabber-root .lesson-item{display:flex;align-items:center;gap:6px;padding:5px 6px;border-bottom:1px solid #eee;font-size:12px}
#grabber-root .lesson-item.full{background:#fef2f2}
#grabber-root .lesson-item .info{flex:1}
#grabber-root .lesson-item .cnt{font-size:11px}
#grabber-root .full-tag{color:#dc2626;font-weight:bold}
#grabber-root .ok-tag{color:#16a34a;font-weight:bold}
#grabber-root .search-wrap{margin-bottom:6px}
#grabber-root #grabber-log{background:#111;color:#7cff7c;font-family:Consolas,monospace;font-size:11px;
padding:8px;border-radius:5px;height:130px;overflow:auto;white-space:pre-wrap}
#grabber-root .tabs{display:flex;gap:6px;margin-bottom:8px}
#grabber-root .tabs button{flex:1}
#grabber-root .tab-active{background:#1a56db !important;color:#fff}
#grabber-root .lessons{max-height:220px;overflow:auto;border:1px solid #ddd;border-radius:5px}
#grabber-root .empty{color:#999;text-align:center;padding:15px}
#grabber-root .grabber-mode{margin:6px 0}
#grabber-root .badge{display:inline-block;background:#f59e0b;color:#fff;border-radius:10px;padding:2px 8px;font-size:11px;margin-left:6px}
</style>
<div class="row" style="display:flex;justify-content:space-between;align-items:center">
    <h3>🎯 长大教务抢课助手</h3>
    <span id="grabber-status" style="font-size:12px;color:#999">未启动</span>
</div>
<!-- 最近一次提交结果（大字醒目显示） -->
<div id="grabber-last" style="display:none;margin-bottom:8px;padding:10px 12px;border-radius:6px;font-size:14px;font-weight:bold;color:#fff;text-align:center"></div>
<div class="tabs">
    <button id="grabber-tab-targets" class="btn-ghost tab-active">目标课程</button>
    <button id="grabber-tab-search" class="btn-ghost">课程库</button>
</div>
<!-- 目标课程面板 -->
<div id="grabber-panel-targets">
    <div class="row">
        <div style="display:flex;gap:6px;margin-bottom:6px">
            <input id="grabber-tvalue" placeholder="课程代码 / 课程序号 / 教学班ID / 课程名" style="flex:1">
            <button id="grabber-add" class="btn-primary" style="white-space:nowrap">添加</button>
        </div>
        <div style="font-size:11px;color:#666;margin-bottom:6px">
            添加后按从上到下优先级依次抢，抢到第一个即停止
        </div>
        <div id="grabber-targets"></div>
    </div>
</div>
<!-- 课程库面板 -->
<div id="grabber-panel-search" style="display:none">
    <div class="row">
        <div class="search-wrap">
            <input id="grabber-search" placeholder="搜索课程代码/名称/教师...">
        </div>
        <div style="display:flex;gap:6px;margin-bottom:6px">
            <button id="grabber-load" class="btn-ghost" style="flex:1">🔄 爬取课程列表</button>
            <button id="grabber-refresh-count" class="btn-ghost" style="flex:1">🔄 刷新人数</button>
        </div>
        <div id="grabber-lessons" class="lessons">
            <div class="empty">点"爬取课程列表"加载课程</div>
        </div>
    </div>
</div>
<div class="grabber-mode row" style="display:flex;gap:6px;align-items:center">
    <button id="grabber-mode-quick" class="btn-ghost" style="flex:1">⚡ 快速</button>
    <button id="grabber-mode-watch" class="btn-ghost" style="flex:1">🕐 蹲守</button>
    <span style="font-size:11px;color:#666">间隔</span>
    <input id="grabber-interval" type="number" value="3" style="width:60px" title="秒">
</div>
<div class="row" style="display:flex;gap:6px">
    <button id="grabber-start" class="btn-success" style="flex:1">▶ 开始抢课</button>
    <button id="grabber-stop" class="btn-danger" style="flex:1" disabled>⏹ 停止</button>
</div>
<div class="row">
    <div id="grabber-log"></div>
</div>
`;
        document.body.appendChild(root);
        // 事件绑定
        $('#grabber-tab-targets').onclick = () => switchTab('targets');
        $('#grabber-tab-search').onclick = () => switchTab('search');
        $('#grabber-add').onclick = addTargetFromInput;
        $('#grabber-tvalue').onkeydown = (e) => { if (e.key === 'Enter') addTargetFromInput(); };
        $('#grabber-load').onclick = loadLessons;
        $('#grabber-refresh-count').onclick = refreshCounts;
        $('#grabber-search').oninput = renderLessons;
        $('#grabber-start').onclick = startGrab;
        $('#grabber-stop').onclick = stopGrab;
        $('#grabber-mode-quick').onclick = () => setMode('quick');
        $('#grabber-mode-watch').onclick = () => setMode('watch');
        renderTargets();
        // 自动尝试检测并加载
        detectProfile();
        if (state.profileId) {
            loadLessons();
        } else {
            log('未检测到选课轮次(profileId)，请确认在选课页面打开');
        }
    }
    function switchTab(tab) {
        $('#grabber-tab-targets').classList.toggle('tab-active', tab === 'targets');
        $('#grabber-tab-search').classList.toggle('tab-active', tab === 'search');
        $('#grabber-panel-targets').style.display = tab === 'targets' ? '' : 'none';
        $('#grabber-panel-search').style.display = tab === 'search' ? '' : 'none';
    }
    // 渲染目标列表
    function renderTargets() {
        const box = $('#grabber-targets');
        if (!box) return;
        if (state.targets.length === 0) {
            box.innerHTML = '<div class="empty">尚未添加目标，在上方输入后点"添加"</div>';
            return;
        }
        box.innerHTML = '';
        state.targets.forEach((t, i) => {
            const item = document.createElement('div');
            item.className = 'target-item';
            const typeName = { code: '代码', no: '课程序号', id: '教学班ID', name: '课程名' }[t.type] || t.type;
            item.innerHTML = `<span class="tag">${i + 1}</span>
                <span style="flex:1">${typeName}: <b>${t.value}</b></span>
                <span class="del" title="删除">✕</span>`;
            item.querySelector('.del').onclick = () => { state.targets.splice(i, 1); renderTargets(); };
            box.appendChild(item);
        });
    }
    function addTargetFromInput() {
        const val = $('#grabber-tvalue').value.trim();
        if (!val) return;
        let type = 'name';
        if (/^\d+$/.test(val)) type = 'id';        // 纯数字 -> 教学班ID
        else if (/^[A-Za-z0-9]+\.[0-9A-Za-z]+$/.test(val)) type = 'no';  // 如 TB206001.08
        else if (/^[A-Za-z]*\d+$/.test(val)) type = 'code';              // 如 TB206001 或 1100102
        state.targets.push({ type, value: val });
        $('#grabber-tvalue').value = '';
        renderTargets();
        log(`添加目标: ${type} = ${val}`);
    }
    // 加载课程列表
    async function loadLessons() {
        log('爬取课程列表...');
        try {
            const arr = await fetchLessons();
            if (!arr) { log('爬取失败：未找到课程数据'); return; }
            await fetchCounts();
            renderLessons();
            log(`爬取成功：共 ${arr.length} 个教学班`);
        } catch (e) {
            log('爬取失败: ' + e.message);
        }
    }
    async function refreshCounts() {
        await fetchCounts();
        renderLessons();
        log('人数已刷新');
    }
    // 渲染课程库
    function renderLessons() {
        const box = $('#grabber-lessons');
        if (!box) return;
        const list = Object.values(state.lessonMap);
        if (list.length === 0) { box.innerHTML = '<div class="empty">无课程数据</div>'; return; }
        const kw = ($('#grabber-search').value || '').trim().toLowerCase();
        box.innerHTML = '';
        list.filter(l => {
            if (!kw) return true;
            return (l.code || '').toLowerCase().includes(kw) ||
                (l.no || '').toLowerCase().includes(kw) ||
                (l.name || '').toLowerCase().includes(kw) ||
                (l.teachers || '').toLowerCase().includes(kw);
        }).sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(l => {
            const cnt = state.countMap[l.id];
            const full = cnt && cnt.sc >= cnt.lc;
            const ok = state.successes[l.id];
            const item = document.createElement('div');
            item.className = 'lesson-item' + (full ? ' full' : '');
            const cntHtml = cnt ? (full ? `<span class="full-tag">已满 ${cnt.sc}/${cnt.lc}</span>` : `<span class="cnt">${cnt.sc}/${cnt.lc}</span>`) : '<span class="cnt">人数未知</span>';
            const okHtml = ok ? '<span class="ok-tag">✓已抢</span>' : '';
            item.innerHTML = `<div class="info">
                    <div><b>${l.name || ''}</b> <span style="color:#666">${l.code || ''}</span> <span style="color:#999">${l.no || ''}</span></div>
                    <div style="color:#888">${l.teachers || ''} ${l.campusName || ''}</div>
                </div>
                <div style="text-align:right">
                    ${cntHtml}
                    <div style="margin-top:3px"><button class="btn-sm btn-primary" data-add="${l.id}">+目标</button></div>
                </div>${okHtml}`;
            item.querySelector('[data-add]').onclick = () => {
                state.targets.push({ type: 'id', value: String(l.id) });
                renderTargets();
                switchTab('targets');
                log('已添加目标: ' + l.name + '[' + l.no + '] (id=' + l.id + ')');
            };
            box.appendChild(item);
        });
    }
    // 模式切换
    function setMode(mode) {
        state.mode = mode;
        $('#grabber-mode-quick').classList.toggle('tab-active', mode === 'quick');
        $('#grabber-mode-watch').classList.toggle('tab-active', mode === 'watch');
        log(mode === 'quick' ? '模式：快速' : '模式：蹲守');
    }
    // 开始
    function startGrab() {
        if (state.targets.length === 0) { alert('请先添加目标课程'); return; }
        const iv = parseInt($('#grabber-interval').value, 10);
        if (iv > 0) {
            if (state.mode === 'quick') CONFIG.quickInterval = iv * 1000;
            else CONFIG.watchInterval = iv * 1000;
        }
        state.running = true;
        state.failStreak = 0;
        $('#grabber-start').disabled = true;
        $('#grabber-stop').disabled = false;
        $('#grabber-status').textContent = '运行中(' + state.mode + ')';
        $('#grabber-status').style.color = '#16a34a';
        log('=== 开始抢课（模式:' + state.mode + '）===');
        runOnce();
    }
    function stopGrab() {
        state.running = false;
        if (timer) clearTimeout(timer);
        $('#grabber-start').disabled = false;
        $('#grabber-stop').disabled = true;
        $('#grabber-status').textContent = '已停止';
        $('#grabber-status').style.color = '#999';
        log('已停止');
    }
    // 简单通知（不依赖 GM API，任何环境可用）
    function notify(title, text) {
        log('【' + title + '】' + text);
        // 声音提示
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.6);
        } catch (e) { }
        // 页面内浮动通知
        try {
            const n = document.createElement('div');
            n.style.cssText = 'position:fixed;top:80px;right:20px;z-index:999999;background:#16a34a;color:#fff;' +
                'padding:14px 20px;border-radius:8px;font:14px "Microsoft YaHei";box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:320px';
            n.innerHTML = '<b>' + title + '</b><br>' + text;
            document.body.appendChild(n);
            setTimeout(() => { n.style.transition = 'opacity .5s'; n.style.opacity = '0'; setTimeout(() => n.remove(), 500); }, 6000);
        } catch (e) { }
        // 最后尝试 alert（可能有用户拦截）
        try { alert(title + '\n' + text); } catch (e) { }
    }
    function log(msg) {
        console.log('[抢课助手]', msg);
        const el = $('#grabber-log');
        if (el) {
            el.textContent = new Date().toLocaleTimeString() + ' ' + msg + '\n' + el.textContent;
        }
    }
    // ==================== 启动 ====================
    function isElectPage() {
        return location.host.indexOf('bkjw.chd.edu.cn') >= 0 &&
            location.pathname.indexOf('stdElectCourse') >= 0;
    }
    function buildMiniUI() {
        // 非选课页面：显示一个小的悬浮按钮，提示去选课页
        if ($('#grabber-mini')) return;
        const btn = document.createElement('div');
        btn.id = 'grabber-mini';
        btn.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:999999;background:#1a56db;color:#fff;' +
            'border-radius:30px;padding:10px 16px;font:13px "Microsoft YaHei";cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);' +
            'display:flex;align-items:center;gap:6px';
        btn.innerHTML = '🎯 抢课助手';
        btn.title = '请打开长安大学教务系统选课页使用完整功能';
        btn.onclick = () => {
            alert('请在选课页面使用完整抢课功能\n\n打开方式：\n1. 登录 http://bkjw.chd.edu.cn/eams/stdElectCourse.action\n2. 点"进入选课>>>>"\n3. 右上角会出现完整面板');
            window.open('http://bkjw.chd.edu.cn/eams/stdElectCourse.action', '_blank');
        };
        document.body.appendChild(btn);
        console.log('[抢课助手] 非选课页面，显示入口按钮。当前URL:', location.href);
    }
    function init() {
        if (!isElectPage()) {
            // 任何页面都显示入口按钮
            if (document.body) {
                buildMiniUI();
            } else {
                document.addEventListener('DOMContentLoaded', buildMiniUI);
            }
            return;
        }
        detectProfile();
        buildUI();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();