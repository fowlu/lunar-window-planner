'use strict';

const lunarHero = document.querySelector('.hero');
const lunarToggle = document.getElementById('motionToggle');
const lunarPhoto = document.querySelector('.hero-media img');
const lunarPreference = matchMedia('(prefers-reduced-motion: reduce)');
const lunarPointer = matchMedia('(pointer: fine)');
let lunarMotion = !lunarPreference.matches;

function resetPhotoPosition() {
  lunarPhoto.style.removeProperty('--move-x');
  lunarPhoto.style.removeProperty('--move-y');
}

function setLunarMotion(enabled) {
  lunarMotion = enabled;
  lunarHero.classList.toggle('still', !enabled);
  lunarToggle.textContent = enabled ? 'Pause motion' : 'Play motion';
  if (!enabled) resetPhotoPosition();
}

lunarHero.addEventListener('pointermove', event => {
  if (!lunarMotion || !lunarPointer.matches) return;
  const bounds = lunarHero.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width - .5;
  const y = (event.clientY - bounds.top) / bounds.height - .5;
  lunarPhoto.style.setProperty('--move-x', x * 16 + 'px');
  lunarPhoto.style.setProperty('--move-y', y * 13 + 'px');
});
lunarHero.addEventListener('pointerleave', resetPhotoPosition);
lunarToggle.addEventListener('click', () => setLunarMotion(!lunarMotion));
lunarPreference.addEventListener('change', event => setLunarMotion(!event.matches));
lunarToggle.hidden = false;
setLunarMotion(lunarMotion);
