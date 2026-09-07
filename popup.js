document.getElementById('open-elect').addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://bkjw.chd.edu.cn/eams/stdElectCourse.action' });
});
document.getElementById('open-readme').addEventListener('click', () => {
    const readme = `长大教务抢课助手使用说明
1. 打开教务系统并登录：
   http://bkjw.chd.edu.cn/eams/stdElectCourse.action
2. 点"进入选课>>>>"进入选课操作页
3. 页面右上角会出现 🎯 抢课助手 面板
4. 添加目标课程（两种方式）：
   - "课程库"标签 → 搜索课程 → 点"+目标"
   - 或直接输入课程代码/课程序号/教学班ID/课程名
5. 选择模式：
   - ⚡ 快速：默认3秒一次，适合抢课
   - 🕐 蹲守：默认60秒一次，适合蹲点
6. 点"开始抢课"，抢到自动停止并通知
注意：
- 目标按添加顺序优先，抢到第一个即停
- 满员会自动降频到蹲守模式防封
- 只抢自己需要的课`;
    const win = window.open('', '_blank');
    win.document.write('<pre style="font-family:Consolas;font-size:13px;padding:20px;white-space:pre-wrap">' + readme + '</pre>');
});