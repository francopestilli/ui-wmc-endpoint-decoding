/* ─────────────────────────────────────────────────────────────────
   charts.js — live Radar + Word Cloud for topic decoding scores
   Replaces the pre-rendered *_radar.png / *_wordcloud.png images.
   Depends on: Vue 2 only. Both render as SVG on the site's dark ground
   and are coloured with a dim → bright ramp of the given cluster colour,
   so the strongest topics read brightest. Both are interactive: click a
   bar / word to open that topic (emits 'select-topic'), hover to link the
   two charts (emits 'hover-topic'); `selectedTopic` / `hoverTopic` props
   highlight the matching bar and words.
   ───────────────────────────────────────────────────────────────── */

// "102_novel_repetition_priming" → ["novel", "repetition", "priming"]
// (multi-word terms like "self referential" are kept together)
function topicTerms(raw) {
  return raw.replace(/^\d+_/, '').split('_').map(s => s.trim()).filter(Boolean);
}

function _hexToRgb(h) {
  h = h.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function _rgbToHex(c) {
  return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function _lerp(a, b, t) { return a.map((x, i) => x + (b[i] - x) * t); }

// Sequential ramp for one cluster colour: pale tint → the colour → a
// darkened shade, so strong topics read darker, like the original PNGs.
function clusterRamp(base) {
  const b = _hexToRgb(base || '#4f8ef7');
  return [_lerp([255, 255, 255], b, 0.18), b, b.map(x => x * 0.42)].map(_rgbToHex);
}
// Same idea for charts drawn on the dark page ground: muted (mixed with the
// ground) → the colour → a pale, bright tint, so strong = bright.
function darkRamp(base) {
  const b = _hexToRgb(base || '#4f8ef7');
  return [_lerp([23, 35, 52], b, 0.42), b, _lerp(b, [255, 255, 255], 0.5)].map(_rgbToHex);
}
function rampColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const s = stops.map(_hexToRgb);
  const x = t * (s.length - 1);
  const i = Math.min(Math.floor(x), s.length - 2);
  return _rgbToHex(_lerp(s[i], s[i + 1], x - i));
}

// Same ramp as [r,g,b] in 0–1 (for three.js vertex colours) and as a CSS gradient (legend).
function rampRgb01(stops, t) { return _hexToRgb(rampColor(stops, t)).map(v => v / 255); }
function rampGradientCss(stops) { return 'linear-gradient(to right, ' + stops.join(', ') + ')'; }

// ─── Radar (polar bar) chart ───────────────────────────────────────
// Top-N topics by score, highest at 3 o'clock, descending anticlockwise.
const RADAR = { R0: 40, R1: 165, RL: 192, LH: 21 };

Vue.component('topic-radar', {
  props: {
    scores: { type: Object, default: null },   // { topicName: value }
    color:  { type: String, default: '#4f8ef7' },
    n:      { type: Number, default: 10 },
    // Optional { topicName: [[term, weight], …] } — e.g. functional terms only.
    // When given, bars are labelled with each topic's top 3 of these terms.
    termSets: { type: Object, default: null },
    selectedTopic: { type: String, default: null },
    hoverTopic:    { type: String, default: null }
  },
  template: `
  <svg class="chart-svg" viewBox="-340 -320 680 640" role="img"
       :aria-label="'Radar chart of top ' + bars.length + ' topics'">
    <g v-if="!bars.length"><text class="chart-empty" x="0" y="0" text-anchor="middle">No positive topic scores</text></g>
    <g v-else>
      <circle v-for="t in ticks" :key="'c'+t.v" :r="t.r" class="radar-grid" />
      <line v-for="b in bars" :key="'s'+b.topic" class="radar-spoke"
            :x1="b.sx0" :y1="b.sy0" :x2="b.sx1" :y2="b.sy1" />
      <g v-for="b in bars" :key="'g'+b.topic" class="radar-item"
         :class="{ active: selectedTopic === b.topic, hot: hoverTopic === b.topic, dim: (hoverTopic || selectedTopic) && hoverTopic !== b.topic && selectedTopic !== b.topic }"
         role="button" tabindex="0"
         @click="$emit('select-topic', b.topic)" @keydown.enter.space.prevent="$emit('select-topic', b.topic)"
         @mouseenter="$emit('hover-topic', b.topic)" @mouseleave="$emit('hover-topic', null)">
        <path :d="b.path" :fill="b.fill" class="radar-bar"><title>{{ b.label }}: r = {{ b.value.toFixed(3) }} — click for the full term list</title></path>
        <text class="radar-label" :text-anchor="b.anchor">
          <tspan v-for="(w, i) in b.lines" :key="i" :x="b.lx" :y="b.ly + i * lh">{{ w }}</tspan>
        </text>
      </g>
      <text v-for="t in ticks" :key="'t'+t.v" class="radar-tick" x="0" :y="-t.r" dy="-3" text-anchor="middle">{{ t.v.toFixed(1) }}</text>
    </g>
  </svg>`,
  data() { return { lh: RADAR.LH }; },
  computed: {
    top() {
      if (!this.scores) return [];
      return Object.entries(this.scores)
        .filter(([, v]) => v !== null && !isNaN(v) && v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, this.n);
    },
    rMax() {
      const m = this.top.length ? this.top[0][1] : 0;
      return Math.max(0.1, Math.ceil(m * 10) / 10);
    },
    ticks() {
      const out = [];
      for (let k = 0; k <= Math.round(this.rMax * 10); k++) {
        const v = k / 10;
        out.push({ v, r: this.rad(v) });
      }
      return out;
    },
    bars() {
      const N = this.top.length;
      if (!N) return [];
      const step = 2 * Math.PI / N, half = step * 0.4;
      const stops = darkRamp(this.color);
      const vHi = this.top[0][1], vLo = this.top[N - 1][1];
      const P = (r, a) => [r * Math.cos(a), -r * Math.sin(a)];   // SVG y points down
      return this.top.map(([topic, value], i) => {
        const a = i * step, r1 = this.rad(value), r0 = RADAR.R0;
        const [ax0, ay0] = P(r0, a - half), [ax1, ay1] = P(r1, a - half);
        const [bx1, by1] = P(r1, a + half), [bx0, by0] = P(r0, a + half);
        const path = `M${ax0},${ay0} L${ax1},${ay1} A${r1},${r1} 0 0 0 ${bx1},${by1}` +
                     ` L${bx0},${by0} A${r0},${r0} 0 0 1 ${ax0},${ay0} Z`;
        const t = vHi > vLo ? (value - vLo) / (vHi - vLo) : 1;
        // one word per line, like the original figures
        const set = this.termSets && this.termSets[topic];
        const labelTerms = set && set.length ? set.slice(0, 3).map(t => t[0]) : topicTerms(topic);
        const lines = labelTerms.join(' ').split(/\s+/).slice(0, 5);
        const cos = Math.cos(a), sin = Math.sin(a);
        const [lx, lyMid] = P(RADAR.RL, a);
        let ly = lyMid - (lines.length - 1) * RADAR.LH / 2 + 5;
        if (sin > 0.3)  ly -= (lines.length - 1) * RADAR.LH / 2;   // above: grow upward
        if (sin < -0.3) ly += (lines.length - 1) * RADAR.LH / 2;   // below: grow downward
        const [sx0, sy0] = P(r0, a), [sx1, sy1] = P(RADAR.R1 + 12, a);
        return {
          topic, value, path, lines, lx, ly, sx0, sy0, sx1, sy1,
          label: labelTerms.join(', '),
          fill: rampColor(stops, 0.2 + 0.8 * t),
          anchor: cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle'
        };
      });
    }
  },
  methods: {
    rad(v) { return RADAR.R0 + (RADAR.R1 - RADAR.R0) * Math.max(0, v) / this.rMax; }
  }
});

// ─── Word cloud ────────────────────────────────────────────────────
// Each topic's terms are weighted by that topic's (positive) decoding
// score, summed across topics that share a term. Words are placed
// biggest-first along an elliptical spiral with box collision checks.
const _measureCtx = document.createElement('canvas').getContext('2d');

function _hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

function layoutWordCloud(weights, opts) {
  const { width: W, height: H, maxWords, minFont, maxFont, fontFamily, stops } = opts;
  const items = Object.entries(weights).sort((a, b) => b[1] - a[1]).slice(0, maxWords);
  if (!items.length) return [];
  const wHi = items[0][1], wLo = items[items.length - 1][1];
  const placed = [], boxes = [];
  const overlaps = b => boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);

  items.forEach(([text, w], idx) => {
    const t = wHi > wLo ? (w - wLo) / (wHi - wLo) : 1;
    let size = minFont + (maxFont - minFont) * Math.pow(t, 0.9);
    const rot = idx > 0 && _hash(text) % 4 === 0 ? 90 : 0;   // ~1 in 4 words vertical
    for (let attempt = 0; attempt < 3; attempt++, size *= 0.8) {
      _measureCtx.font = `600 ${size}px ${fontFamily}`;
      const m = _measureCtx.measureText(text);
      const asc = m.actualBoundingBoxAscent || size * 0.72;
      const desc = m.actualBoundingBoxDescent || size * 0.2;
      const tw = m.width + 2, th = asc + desc + 2;
      const bw = rot ? th : tw, bh = rot ? tw : th;
      if (bw > W || bh > H) continue;
      for (let k = 0; k < 2500; k++) {
        const a = k * 0.12, r = 1.6 * a;
        const cx = r * Math.cos(a) * (W / H), cy = r * Math.sin(a);
        const box = { x0: cx - bw / 2, x1: cx + bw / 2, y0: cy - bh / 2, y1: cy + bh / 2 };
        if (box.x0 < -W / 2 || box.x1 > W / 2 || box.y0 < -H / 2 || box.y1 > H / 2) {
          if (r > Math.max(W, H)) break; else continue;
        }
        if (overlaps(box)) continue;
        boxes.push(box);
        placed.push({
          text, weight: w, size, rot, x: cx, y: cy,
          baseline: (asc - desc) / 2,
          fill: rampColor(stops, 0.3 + 0.7 * t)
        });
        return;
      }
    }
  });
  return placed;
}

Vue.component('topic-wordcloud', {
  props: {
    scores:   { type: Object, default: null },
    color:    { type: String, default: '#4f8ef7' },
    maxWords: { type: Number, default: 90 },
    // Optional { topicName: [[term, weight], …] }: each term then counts
    // topic score × term weight. Default: the 3 terms in the topic name, weight 1.
    termSets: { type: Object, default: null },
    selectedTopic: { type: String, default: null },
    hoverTopic:    { type: String, default: null }
  },
  template: `
  <svg class="chart-svg" :viewBox="(-W/2) + ' ' + (-H/2) + ' ' + W + ' ' + H" role="img" aria-label="Topic word cloud">
    <text v-if="!words.length" class="chart-empty" x="0" y="0" text-anchor="middle">No positive topic scores</text>
    <text v-for="w in words" :key="w.text" class="cloud-word" text-anchor="middle"
          :class="{ hot: isHot(w), dim: (hoverTopic || selectedTopic) && !isHot(w) }"
          role="button" tabindex="0"
          :x="w.x" :y="w.y + w.baseline" :font-size="w.size" :fill="w.fill"
          :transform="w.rot ? 'rotate(-90 ' + w.x + ' ' + w.y + ')' : null"
          @click="$emit('select-topic', mainTopic[w.text])" @keydown.enter.space.prevent="$emit('select-topic', mainTopic[w.text])"
          @mouseenter="$emit('hover-topic', mainTopic[w.text])" @mouseleave="$emit('hover-topic', null)">{{ w.text }}<title>{{ w.text }} — weight {{ w.weight.toFixed(3) }} · in {{ (wordTopics[w.text] || []).length }} topic(s); click for the strongest</title></text>
  </svg>`,
  data() { return { W: 680, H: 640, words: [], wordTopics: {}, mainTopic: {} }; },  // same shape as the radar
  watch: {
    scores()   { this.layout(); },
    color()    { this.layout(); },
    termSets() { this.layout(); }
  },
  mounted() { this.layout(); },
  methods: {
    isHot(w) {
      const ts = this.wordTopics[w.text] || [];
      return (this.hoverTopic && ts.includes(this.hoverTopic)) || (this.selectedTopic && ts.includes(this.selectedTopic));
    },
    layout() {
      const weights = {}, byWord = {};
      if (this.scores) {
        Object.entries(this.scores).forEach(([topic, v]) => {
          if (v === null || isNaN(v) || v <= 0) return;
          const set = this.termSets ? (this.termSets[topic] || []) : topicTerms(topic).map(t => [t, 1]);
          set.forEach(([term, w]) => {
            const k = term.toLowerCase();
            weights[k] = (weights[k] || 0) + v * w;
            (byWord[k] = byWord[k] || []).push([topic, v * w]);
          });
        });
      }
      // Which topics each word comes from (for highlighting) and the one
      // contributing most (what a click opens).
      const wordTopics = {}, mainTopic = {};
      Object.entries(byWord).forEach(([k, list]) => {
        list.sort((a, b) => b[1] - a[1]);
        wordTopics[k] = list.map(x => x[0]);
        mainTopic[k] = list[0][0];
      });
      this.wordTopics = Object.freeze(wordTopics);
      this.mainTopic = Object.freeze(mainTopic);
      const fontFamily = (this.$el && getComputedStyle(this.$el).fontFamily) || 'sans-serif';
      this.words = layoutWordCloud(weights, {
        width: this.W, height: this.H, maxWords: this.maxWords,
        minFont: 12, maxFont: 90, fontFamily, stops: darkRamp(this.color)
      });
    }
  }
});
