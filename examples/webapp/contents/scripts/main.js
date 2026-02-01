const ready = require('./vendor/ready');
require('browsernizr/test/css/rgba');
require('browsernizr/test/css/transforms3d');
const Modernizr = require('browsernizr');

function getTransformProperty(element) {
  const properties = ['transform', 'WebkitTransform', 'msTransform', 'MozTransform', 'OTransform'];
  for (const prop of properties) {
    if (element.style[prop] != null) return prop;
  }
  return properties[0];
}

class Cylon {
  constructor(element) {
    this.element = element;
    const text = element.innerHTML;
    element.innerHTML = '';
    this.letters = [];
    for (const letter of text) {
      const el = document.createElement('span');
      el.innerHTML = letter.replace(' ', '&nbsp;');
      element.appendChild(el);
      this.letters.push(el);
    }
    this.tprop = getTransformProperty(element);
  }

  start() {
    let last = Date.now();
    const step = () => {
      const time = Date.now();
      const delta = time - last;
      this.step(time, delta);
      last = time;
    };
    this.timer = setInterval(step, 1000 / 30);
    step();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  step(time, delta) {
    for (let i = 0; i < this.letters.length; i++) {
      const el = this.letters[i];
      let a = Math.sin(time / 400) - 5 * (i / this.letters.length);
      a = (a + 1) / 2;
      const rgb = [10 + Math.round(a * 245), 10, 10];
      el.style.color = `rgb(${rgb.join(',')})`;
      el.style.textShadow = `0 0 ${a / 12}em red`;
      if (Modernizr.csstransforms3d) {
        el.style[this.tprop] = `rotateX(${-20 + a * 40}deg)`;
      }
    }
  }
}

function main() {
  const cylon = new Cylon(document.querySelector('h1'));
  cylon.start();
}

ready(main);
