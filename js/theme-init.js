try{var t=localStorage.getItem('theme');if(t&&t!=='auto')document.documentElement.dataset.theme=t}catch(e){}
// шрифты не задерживают первую отрисовку: подключаем без блокировки (display=swap — текст виден сразу)
(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';document.head.appendChild(l)})();
