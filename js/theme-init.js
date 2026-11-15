try{var t=localStorage.getItem('theme');if(t&&t!=='auto')document.documentElement.dataset.theme=t}catch(e){}
// шрифты не задерживают первую отрисовку: подключаем без блокировки (display=swap — текст виден сразу)
(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap';document.head.appendChild(l)})();
