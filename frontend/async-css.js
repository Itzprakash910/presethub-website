/* Switches stylesheets marked data-async-css from print to all once loaded (keeps them off the critical path). */
(function(){document.querySelectorAll('link[data-async-css]').forEach(function(l){function on(){l.media='all';} if(l.sheet) on(); else l.addEventListener('load',on);});})();
