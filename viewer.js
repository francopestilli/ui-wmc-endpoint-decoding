/* ─────────────────────────────────────────────────────────────────
   WMC Tract Endpoint Decoding Viewer  —  combined cluster + tract view
   Depends on: Vue 2, PapaParse
   ───────────────────────────────────────────────────────────────── */

// Cluster colour palette — used by the live dendrogram, charts and 3D maps
const CLUSTER_COLORS = [
  '#e07b7b', // 1 – red
  '#d4a843', // 2 – amber
  '#6bbf6b', // 3 – green
  '#5aaccc', // 4 – blue
  '#9b75d4', // 5 – purple
  '#d47a5a', // 6 – orange
  '#3fb8a8', // 7 – teal (was sky blue, too close to cluster 4)
  '#b0c93e', // 8 – lime
  '#e080c0'  // 9 – pink
];

// Diverging colour scale: blue → white → red (for decoding scores)
function scoreToColor(v, vmin, vmax) {
  if (v === null || isNaN(v)) return '#2a2d40';
  const mid = (vmin + vmax) / 2;
  let t;
  if (v < mid) {
    t = (v - vmin) / (mid - vmin);
    const r = Math.round(59  + t * (240 - 59));
    const g = Math.round(108 + t * (240 - 108));
    const b = Math.round(196 + t * (240 - 196));
    return `rgb(${r},${g},${b})`;
  } else {
    t = (v - mid) / (vmax - mid);
    const r = Math.round(240 + t * (196 - 240));
    const g = Math.round(240 - t * (240 - 59));
    const b = Math.round(240 - t * (240 - 59));
    return `rgb(${r},${g},${b})`;
  }
}

// Parse topic label: "102_novel_repetition_priming" → "novel repetition priming"
function topicLabel(raw) {
  return raw.replace(/^\d+_/, '').replace(/_/g, ' ');
}

// Topic detail panel: full LDA term list for the topic clicked in
// "Top Cognitive Topics" (data: assets/decoding/topic-terms.json, made by
// scripts/export_topic_terms.py). Shared by the Cluster and Tract views.
const TOPIC_PANEL_TEMPLATE = `
              <aside class="panel-card topic-detail" v-if="selectedTopic">
                <div class="panel-card-title topic-detail-title">
                  <span>Topic {{ topicId(selectedTopic) }}</span>
                  <button class="topic-detail-close" @click="selectedTopic = null" aria-label="Close topic panel">×</button>
                </div>
                <div class="topic-detail-body">
                  <div class="topic-detail-name">{{ topicLabel(selectedTopic) }}</div>
                  <div class="topic-detail-score" v-if="tab === 'tract'">
                    <span v-for="src in endpointSources" :key="src.key" class="topic-detail-side">
                      {{ src.label }}: <strong>{{ fmtR(src.row && src.row[selectedTopic]) }}</strong>
                    </span>
                  </div>
                  <div class="topic-detail-score" v-else-if="selectedTopicScore !== null">
                    r = <strong>{{ selectedTopicScore.toFixed(3) }}</strong> for {{ topicSubjectLabel }}
                  </div>
                  <label class="topic-detail-filter">
                    <input type="checkbox" v-model="topicFunctionalOnly" /> Functional terms only
                  </label>
                  <div v-if="!topicTerms" class="text-muted">Loading term list…</div>
                  <div v-else-if="!selectedTopicTerms" class="text-muted">No term list available for this topic.</div>
                  <ol class="term-list" v-else>
                    <li v-for="(t, i) in selectedTopicTerms" :key="t[0]" class="term-row" :title="t[0] + ' — ' + t[2] + ', weight ' + t[1].toFixed(3)">
                      <span class="term-rank">{{ i + 1 }}</span>
                      <span class="term-name">{{ t[0] }}</span>
                      <span class="term-class" :class="termClassCss(t[2])">{{ termClassShort(t[2]) }}</span>
                      <span class="term-bar"><span :style="{ width: (t[1] * 100) + '%' }"></span></span>
                    </li>
                  </ol>
                  <div class="topic-detail-legend">
                    <span class="term-class tc-functional">F</span> Functional
                    <span class="term-class tc-anatomical">A</span> Anatomical
                    <span class="term-class tc-clinical">C</span> Clinical
                    <span class="term-class tc-nonspecific">N</span> Non-specific
                    <div>Bars: LDA term weight (top term = 1)</div>
                  </div>
                </div>
              </aside>
`;

// Shared 3D endpoint-map panel, used by both the Cluster and Tract views.
// Only one view is mounted at a time, so the canvas refs never collide.
const SURF_PANEL_TEMPLATE = `
            <!-- Live 3D cortical endpoint map, rendered from func.gii (tract, or max across a cluster's tracts) -->
            <template v-if="surfBase && surfMeshBase">
              <div class="tract-section-title">Cortical Endpoint Map (3D)</div>
              <div class="tract-surf-row">
                <div class="panel-card surf-card">
                  <div class="panel-card-title">RAS orientation</div>
                  <div class="surf-canvas-wrap">
                    <canvas ref="surfCanvasRAS"></canvas>
                    <div class="surf-overlay" v-if="surfStatus.RAS === 'loading'"><div class="spinner"></div></div>
                    <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'empty'">No RAS surface data for this selection</div>
                    <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'nomembers'">Cluster membership couldn't be computed for this threshold</div>
                    <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'nowebgl'">3D view unavailable (WebGL failed to start in this browser)</div>
                  </div>
                  <div class="surf-legend" v-if="surfStatus.RAS === 'ready'">
                    <span>0</span><div class="legend-grad hot"></div><span>{{ surfMax.RAS.toFixed(2) }}</span>
                  </div>
                </div>
                <div class="panel-card surf-card">
                  <div class="panel-card-title">LPI orientation</div>
                  <div class="surf-canvas-wrap">
                    <canvas ref="surfCanvasLPI"></canvas>
                    <div class="surf-overlay" v-if="surfStatus.LPI === 'loading'"><div class="spinner"></div></div>
                    <div class="surf-overlay surf-empty" v-if="surfStatus.LPI === 'empty'">No LPI surface data for this selection</div>
                    <div class="surf-overlay surf-empty" v-if="surfStatus.LPI === 'nomembers'">Cluster membership couldn't be computed for this threshold</div>
                    <div class="surf-overlay surf-empty" v-if="surfStatus.LPI === 'nowebgl'">3D view unavailable (WebGL failed to start in this browser)</div>
                  </div>
                  <div class="surf-legend" v-if="surfStatus.LPI === 'ready'">
                    <span>0</span><div class="legend-grad hot"></div><span>{{ surfMax.LPI.toFixed(2) }}</span>
                  </div>
                </div>
              </div>
              <div class="text-muted" style="font-size:12px;margin:2px 0 20px;">
                Drag to rotate, scroll to zoom. Both orientation conventions are shown side-by-side
                for QA — they don't always agree, and which one is anatomically correct for this
                dataset hasn't been confirmed yet.
              </div>
            </template>

`;

// Cluster View: ONE combined map — every member tract's LPI and RAS
// endpoint maps merged (per-vertex max), like the "Cluster #N_LPI+RAS"
// figures, coloured with the cluster's own colour ramp.
const CLUSTER_SURF_TEMPLATE = `
            <template v-if="surfBase && surfMeshBase">
              <div class="tract-section-title">Cortical Endpoint Map (3D)</div>
              <div class="panel-card surf-card" style="max-width:900px;">
                <div class="panel-card-title">Cluster {{ selectedCluster }} — LPI + RAS combined</div>
                <div class="surf-canvas-wrap">
                  <canvas ref="surfCanvasRAS"></canvas>
                  <div class="surf-overlay" v-if="surfStatus.RAS === 'loading'"><div class="spinner"></div></div>
                  <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'empty'">No surface data for this cluster's tracts</div>
                  <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'nomembers'">Cluster membership couldn't be computed for this threshold</div>
                  <div class="surf-overlay surf-empty" v-if="surfStatus.RAS === 'nowebgl'">3D view unavailable (WebGL failed to start in this browser)</div>
                </div>
                <div class="surf-legend" v-if="surfStatus.RAS === 'ready'">
                  <span>0</span><div class="legend-grad" :style="{ background: clusterLegendCss }"></div><span>{{ surfMax.RAS.toFixed(2) }}</span>
                </div>
              </div>
              <div class="text-muted" style="font-size:12px;margin:2px 0 20px;">
                Union of the endpoint maps of all {{ activeCluster.tracts.length }} tracts in this cluster, both orientations.
                Drag to rotate, scroll to zoom.
              </div>
            </template>
`;

// ─── Main component ────────────────────────────────────────────────
Vue.component('wmc-viewer', {
  props: ['config'],

  template: `
  <div class="wmc-root">

    <!-- ── Header ─────────────────────────────────────────── -->
    <header class="wmc-header">
      <div class="wmc-title">WMC Tract <span>Endpoint Decoding</span></div>
      <div class="header-spacer"></div>
      <div class="control-group">
        <label>Threshold</label>
        <select v-model="selectedThreshold" @change="onThresholdChange">
          <option v-for="(folder, label) in config.thresholds" :key="label" :value="label">{{ label }}</option>
        </select>
      </div>
      <div class="control-group" v-if="numClusters > 0">
        <label>Clusters</label>
        <span class="stat-chip">{{ numClusters }}</span>
      </div>
      <div class="control-group" v-if="tractOrder.length > 0">
        <label>Tracts</label>
        <span class="stat-chip">{{ tractOrder.length }}</span>
      </div>
    </header>

    <!-- ── Body ───────────────────────────────────────────── -->
    <div class="wmc-body">

      <!-- ── Sidebar ──────────────────────────────────────── -->
      <nav class="wmc-sidebar">

        <!-- Sidebar mode tabs -->
        <div class="sidebar-tabs">
          <button class="stab" :class="{active: sideMode==='clusters'}" @click="sideMode='clusters'" v-if="clustersEnabled">
            Clusters
          </button>
          <button class="stab" :class="{active: sideMode==='tracts'}" @click="sideMode='tracts'">
            Tracts
          </button>
        </div>

        <!-- CLUSTER MODE -->
        <template v-if="sideMode==='clusters'">
          <div class="sidebar-section">Dendrogram</div>
          <div class="dendro-wrap" v-if="clustering">
            <tract-dendrogram
              :clustering="clustering"
              :colors="clusterColors"
              :selected-cluster="selectedCluster"
              :selected-tract="selectedTract"
              @select-cluster="selectCluster"
              @select-tract="selectTractAndSwitch"
            ></tract-dendrogram>
            <div class="dendro-note">
              Complete linkage on 1 − r, cut at {{ clustering.cut }}.
              <template v-if="clustering.excluded.length">
                Not clustered (missing decoding scores): {{ clustering.excluded.join(', ') }}.
              </template>
            </div>
          </div>
          <div class="sidebar-section">Clusters</div>
          <div class="cluster-list">
            <button
              v-for="c in clusters"
              :key="c.id"
              class="cluster-btn"
              :class="{ active: selectedCluster === c.id }"
              @click="selectCluster(c.id)"
            >
              <span class="cluster-dot" :style="{ background: c.color }"></span>
              <span class="cluster-label">Cluster {{ c.id }}</span>
              <span class="cluster-count" v-if="c.tracts.length">{{ c.tracts.length }} {{ c.tracts.length === 1 ? 'tract' : 'tracts' }}</span>
            </button>
          </div>
        </template>

        <!-- TRACT MODE -->
        <template v-else>
          <div class="sidebar-section" style="display:flex;align-items:center;gap:8px;">
            <span>Tracts</span>
            <input
              class="tract-search"
              v-model="tractSearch"
              placeholder="Search…"
              @focus="tractSearch=''"
            />
          </div>
          <div class="cluster-list">
            <button
              v-for="t in filteredTracts"
              :key="t"
              class="tract-btn"
              :class="{ active: selectedTract === t }"
              @click="selectTract(t)"
            >
              <span class="cluster-dot" :style="{ background: tractClusterColor(t) }"></span>
              <span class="tract-btn-label">{{ t }}</span>
              <span class="cluster-count">C{{ tractClusterIndex(t) }}</span>
            </button>
          </div>
        </template>
      </nav>

      <!-- ── Content ──────────────────────────────────────── -->
      <main class="wmc-content">

        <!-- Tabs -->
        <div class="wmc-tabs">
          <button class="tab-btn" :class="{active: tab==='cluster'}" @click="showClusterView" v-if="clustersEnabled">Cluster View</button>
          <button class="tab-btn" :class="{active: tab==='tract'}"   @click="showTractView">Tract View</button>
          <button class="tab-btn" :class="{active: tab==='matrix'}"  @click="tab='matrix'">Full Matrix</button>
        </div>

        <!-- Loading -->
        <div class="tab-panel" v-if="loading">
          <div class="loading"><div class="spinner"></div>Loading data…</div>
        </div>

        <!-- ── CLUSTER VIEW TAB ──────────────────────────── -->
        <div class="tab-panel" v-else-if="tab==='cluster'">
          <div v-if="!selectedCluster" class="empty-state">
            Select a cluster from the sidebar (or switch to "Clusters" mode) to explore its decoding profile.
          </div>
          <div v-else>
            <div class="panel-cluster-header" :style="{ borderColor: activeCluster.color }">
              <span class="panel-cluster-dot" :style="{ background: activeCluster.color }"></span>
              <strong>Cluster {{ selectedCluster }}</strong>
              <span class="text-muted" style="margin-left:8px;" v-if="activeCluster.tracts.length">{{ activeCluster.tracts.length }} {{ activeCluster.tracts.length === 1 ? 'tract' : 'tracts' }}</span>
              <!-- member tracts, right next to the cluster label (click → Tract View) -->
              <div class="header-tract-list" v-if="activeCluster.tracts.length">
                <span
                  class="tract-tag"
                  v-for="t in activeCluster.tracts"
                  :key="t"
                  :style="{ borderColor: activeCluster.color }"
                  @click="selectTractAndSwitch(t)"
                  title="Click to explore this tract"
                >{{ t }}</span>
              </div>
              <span class="text-muted" v-else>Cluster membership couldn't be computed for this threshold.</span>
            </div>

            ${CLUSTER_SURF_TEMPLATE}

            <!-- Live decoding scores for this cluster (if cluster-matrix.csv exists for this threshold) -->
            <template v-if="clusterMatrix[selectedCluster]">
              <div class="tract-section-title">Top Cognitive Topics</div>
              <div class="topics-row">
              <div class="topic-bars">
                <div v-for="item in clusterTopTopics" :key="item.topic" class="topic-bar-row clickable"
                     :class="{ active: selectedTopic === item.topic }" role="button" tabindex="0"
                     @click="toggleTopic(item.topic)" @keydown.enter.space.prevent="toggleTopic(item.topic)">
                  <div class="topic-bar-label" :title="'Click to see all terms in ' + item.topic">{{ topicLabel(item.topic) }}</div>
                  <div class="topic-bar-track">
                    <div
                      class="topic-bar-fill"
                      :style="{
                        width: clusterBarWidth(item.value) + '%',
                        background: item.value >= 0 ? '#4f8ef7' : '#e07b7b'
                      }"
                    ></div>
                    <span class="topic-bar-val">{{ item.value.toFixed(3) }}</span>
                  </div>
                </div>
              </div>
              ${TOPIC_PANEL_TEMPLATE}
              </div>
            </template>

            <label class="chart-term-toggle" v-if="topicTerms && Object.keys(topicTerms).length">
              <input type="checkbox" v-model="topicFunctionalOnly" />
              Functional terms only <span class="text-muted">— radar labels &amp; word cloud use each topic's full list of functional terms</span>
            </label>
            <div class="tract-img-row" v-if="clusterScores">
              <div class="panel-card">
                <div class="panel-card-title">Radar Chart<span v-if="chartTermSets"> · functional terms</span></div>
                <topic-radar :scores="clusterScores" :color="activeCluster.color" :term-sets="chartTermSets"></topic-radar>
              </div>
              <div class="panel-card">
                <div class="panel-card-title">Word Cloud<span v-if="chartTermSets"> · functional terms</span></div>
                <topic-wordcloud :scores="clusterScores" :color="activeCluster.color" :term-sets="chartTermSets"></topic-wordcloud>
              </div>
            </div>

            <!-- Mini strip: all topics for this cluster -->
            <template v-if="clusterMatrix[selectedCluster]">
              <div class="tract-section-title" style="margin-top:24px;">All Topics (decoding score)</div>
              <div class="tract-strip-wrap">
                <div class="tract-strip">
                  <div
                    v-for="topic in topics"
                    :key="topic"
                    class="strip-cell"
                    :style="{ background: clusterCellColor(selectedCluster, topic) }"
                    @mousemove="showClusterTip($event, selectedCluster, topic)"
                    @mouseleave="hideTip"
                  ></div>
                </div>
                <div class="strip-legend">
                  <span>{{ vmin.toFixed(2) }}</span>
                  <div class="legend-grad"></div>
                  <span>{{ vmax.toFixed(2) }}</span>
                  <span style="margin-left:16px;color:var(--text-muted)">r</span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- ── TRACT VIEW TAB ────────────────────────────── -->
        <div class="tab-panel" v-else-if="tab==='tract'">
          <div v-if="!selectedTract" class="empty-state">
            Select a tract from the sidebar (switch to "Tracts" mode) to explore its decoding profile.
          </div>
          <div v-else>
            <div class="panel-cluster-header" :style="{ borderColor: tractClusterColor(selectedTract) }">
              <span class="panel-cluster-dot" :style="{ background: tractClusterColor(selectedTract) }"></span>
              <strong>{{ selectedTract }}</strong>
              <span class="text-muted" style="margin-left:8px;" v-if="clusterAssignments[selectedTract]">Cluster {{ tractClusterIndex(selectedTract) }}</span>
              <span class="text-muted" style="margin-left:8px;" v-else>Not clustered (missing decoding scores at this threshold)</span>
              <button class="show-cluster-btn" v-if="clusterAssignments[selectedTract]" @click="jumpToCluster(tractClusterIndex(selectedTract))">
                View cluster →
              </button>
            </div>

${SURF_PANEL_TEMPLATE}
            <!-- Decoding: joint (LPI + RAS) vs. each endpoint on its own, side by side -->
            <div class="tract-section-title">Top Cognitive Topics — joint vs. each endpoint</div>
            <div class="topics-row">
              <div class="endpoint-cols">
                <div class="endpoint-col" v-for="src in endpointSources" :key="src.key">
                  <div class="endpoint-col-title">{{ src.label }}</div>
                  <div v-if="!src.has" class="endpoint-empty">No {{ src.key }}-only decoding for this tract at this threshold.</div>
                  <div v-else class="topic-bars">
                    <div v-for="item in src.top" :key="item.topic" class="topic-bar-row clickable"
                         :class="{ active: selectedTopic === item.topic }" role="button" tabindex="0"
                         @click="toggleTopic(item.topic)" @keydown.enter.space.prevent="toggleTopic(item.topic)">
                      <div class="topic-bar-label" :title="'Click to see all terms in ' + item.topic">{{ topicLabel(item.topic) }}</div>
                      <div class="topic-bar-track">
                        <div class="topic-bar-fill"
                             :style="{ width: sideBarWidth(item.value) + '%', background: item.value >= 0 ? '#4f8ef7' : '#e07b7b' }"></div>
                        <span class="topic-bar-val">{{ item.value.toFixed(3) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ${TOPIC_PANEL_TEMPLATE}
            </div>

            <!-- Radar + word cloud for each decoding, same column order -->
            <label class="chart-term-toggle" v-if="topicTerms && Object.keys(topicTerms).length">
              <input type="checkbox" v-model="topicFunctionalOnly" />
              Functional terms only <span class="text-muted">— radar labels &amp; word cloud use each topic's full list of functional terms</span>
            </label>
            <div class="endpoint-charts">
              <div class="panel-card" v-for="src in endpointSources" :key="'radar-' + src.key">
                <div class="panel-card-title">Radar · {{ src.label }}</div>
                <topic-radar v-if="src.has" :scores="src.row" :color="tractChartColor" :term-sets="chartTermSets"></topic-radar>
                <div v-else class="endpoint-empty chart-empty-card">No {{ src.key }}-only decoding</div>
              </div>
              <div class="panel-card" v-for="src in endpointSources" :key="'cloud-' + src.key">
                <div class="panel-card-title">Word Cloud · {{ src.label }}</div>
                <topic-wordcloud v-if="src.has" :scores="src.row" :color="tractChartColor" :term-sets="chartTermSets"></topic-wordcloud>
                <div v-else class="endpoint-empty chart-empty-card">No {{ src.key }}-only decoding</div>
              </div>
            </div>

            <!-- Mini strip: all topics for this tract -->
            <div class="tract-section-title" style="margin-top:24px;">All Topics (decoding score)</div>
            <div class="tract-strip-wrap">
              <div class="tract-strip">
                <div
                  v-for="topic in topics"
                  :key="topic"
                  class="strip-cell"
                  :style="{ background: cellColor(selectedTract, topic) }"
                  @mousemove="showTip($event, selectedTract, topic)"
                  @mouseleave="hideTip"
                ></div>
              </div>
              <div class="strip-legend">
                <span>{{ vmin.toFixed(2) }}</span>
                <div class="legend-grad"></div>
                <span>{{ vmax.toFixed(2) }}</span>
                <span style="margin-left:16px;color:var(--text-muted)">r</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── MATRIX TAB ────────────────────────────────── -->
        <div class="tab-panel" v-else-if="tab==='matrix'">
          <div class="matrix-legend">
            <span>{{ vmin.toFixed(2) }}</span>
            <div class="legend-grad"></div>
            <span>{{ vmax.toFixed(2) }}</span>
            <span style="margin-left:16px;color:var(--text-muted)">Decoding score (r)</span>
          </div>
          <div class="matrix-wrap">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th class="corner">Tract → Topic</th>
                  <th class="col-header" v-for="t in topics" :key="t" :title="t">{{ topicLabel(t) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tract in tractOrder" :key="tract" @click="selectTractAndSwitch(tract)" style="cursor:pointer;">
                  <th class="row-header" :style="{ borderLeft: '3px solid ' + tractClusterColor(tract) }">{{ tract }}</th>
                  <td
                    class="cell"
                    v-for="topic in topics"
                    :key="topic"
                    :style="{ background: cellColor(tract, topic) }"
                    @mousemove.stop="showTip($event, tract, topic)"
                    @mouseleave="hideTip"
                  ></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>

    <!-- ── Tooltip ─────────────────────────────────────────── -->
    <div
      class="cell-tooltip"
      v-if="tooltip.visible"
      :style="{ top: tooltip.y + 'px', left: tooltip.x + 'px' }"
    >
      <strong>{{ tooltip.tract }}</strong>
      <span>{{ topicLabel(tooltip.topic) }}</span><br/>
      <span v-if="tooltip.value !== null">r = {{ tooltip.value.toFixed(4) }}</span>
      <span v-else style="color:#e07b7b">No data (NaN)</span>
    </div>

  </div>
  `,

  data() {
    return {
      tab: 'cluster',
      sideMode: 'clusters',     // 'clusters' | 'tracts'
      loading: true,
      selectedThreshold: this.config.defaultThreshold || Object.keys(this.config.thresholds)[0],
      selectedCluster: null,
      selectedTract: null,
      tractSearch: '',
      numClusters: 0,
      clusters: [],             // [{ id, color, tracts }]
      tractOrder: [],           // row order from CSV
      topics: [],               // column names (raw)
      matrix: {},               // { tractName: { topicName: value } }
      clusterAssignments: {},   // { tractName: clusterIndex }
      membershipKnown: false,   // true once clusters have been computed for this threshold
      clustering: null,         // live HCA result from cluster.js (Z, leaves, assignments, …)
      topicTerms: null,         // { "<topic id>": { class, terms: [[term, weight, class], …] } }
      selectedTopic: null,      // raw topic column name shown in the topic detail panel
      topicFunctionalOnly: true,    // on by default: matches the notebook/gradec figures (functional terms)
      clusterMatrix: {},
      matrixRAS: {},            // { tract: { topic: r } } — RAS endpoint decoded on its own (matrix_RAS.csv)
      matrixLPI: {},            // same for the LPI endpoint (matrix_LPI.csv)        // { clusterId: { topicName: value } } — from cluster-matrix.csv, optional
      vmin: -0.5,
      vmax: 0.5,
      tooltip: { visible: false, x: 0, y: 0, tract: '', topic: '', value: null },
      // 3D cortical endpoint map (Tract View) — 'idle' | 'loading' | 'ready' | 'empty'
      surfStatus: { RAS: 'idle', LPI: 'idle' },
      surfMax: { RAS: 0, LPI: 0 }
    };
  },

  computed: {
    // Threshold config value may be a string (legacy) or an object
    thresholdCfg()    {
      const v = this.config.thresholds[this.selectedThreshold];
      return typeof v === 'string' ? { folder: v } : v;
    },
    thresholdFolder() { return this.thresholdCfg.folder; },
    baseUrl()         { return `${this.config.dataBase}/${this.thresholdFolder}`; },
    clusterColors()   { return CLUSTER_COLORS; },
    // Whether this threshold has cluster-level images / clustering data
    clustersEnabled() { return !this.thresholdCfg.noClusters; },
    // Per-tract func.gii endpoint map support (3D surface panel)
    surfBase()        { return this.thresholdCfg.surfBase || null; },
    surfMeshBase()    { return this.config.surfMeshBase || null; },

    // Decoding row behind the cluster radar/word cloud (cluster-matrix.csv).
    clusterScores() {
      return (this.selectedCluster && this.clusterMatrix[this.selectedCluster]) || null;
    },
    // Charts for a tract use the colour of the cluster it belongs to.
    tractChartColor() {
      const c = this.clusterAssignments[this.selectedTract];
      return c ? CLUSTER_COLORS[(c - 1) % CLUSTER_COLORS.length] : '#4f8ef7';
    },
    // Joint / RAS-only / LPI-only decoding rows for the selected tract.
    endpointSources() {
      const t = this.selectedTract;
      const top = row => !row ? [] : Object.entries(row)
        .filter(([, v]) => v !== null && !isNaN(v))
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 10)
        .map(([topic, value]) => ({ topic, value }));
      return [
        { key: 'joint', label: 'LPI + RAS (joint)', row: this.matrix[t] },
        { key: 'RAS',   label: 'RAS only',          row: this.matrixRAS[t] },
        { key: 'LPI',   label: 'LPI only',          row: this.matrixLPI[t] }
      ].map(src => {
        const items = top(src.row);
        return Object.assign(src, { top: items, has: items.length > 0 });
      });
    },
    // One bar scale shared by the three columns so they're directly comparable.
    sideBarMax() {
      let m = 0;
      this.endpointSources.forEach(s => s.top.forEach(x => { m = Math.max(m, Math.abs(x.value)); }));
      return m || 1;
    },
    // { topicName: [[term, weight], …] } of functional terms only, for the
    // radar/word cloud when "Functional terms only" is on; null = default charts.
    chartTermSets() {
      if (!this.topicFunctionalOnly || !this.topicTerms) return null;
      const out = {};
      this.topics.forEach(topic => {
        const entry = this.topicTerms[this.topicId(topic)];
        if (entry) out[topic] = entry.terms.filter(t => t[2] === 'Functional').map(t => [t[0], t[1]]);
      });
      return Object.freeze(out);
    },
    selectedTopicTerms() {
      if (!this.selectedTopic || !this.topicTerms) return null;
      const entry = this.topicTerms[this.topicId(this.selectedTopic)];
      if (!entry) return null;
      return this.topicFunctionalOnly ? entry.terms.filter(t => t[2] === 'Functional') : entry.terms;
    },
    // Score of the open topic for whatever is being viewed (tract or cluster).
    selectedTopicScore() {
      if (!this.selectedTopic) return null;
      const row = this.tab === 'cluster' ? this.clusterMatrix[this.selectedCluster] : this.matrix[this.selectedTract];
      const v = row ? row[this.selectedTopic] : null;
      return v === null || v === undefined || isNaN(v) ? null : v;
    },
    topicSubjectLabel() {
      return this.tab === 'cluster' ? `cluster ${this.selectedCluster}` : this.selectedTract;
    },
    clusterLegendCss() {
      return rampGradientCss(clusterRamp(this.activeCluster ? this.activeCluster.color : null));
    },
    // Tracts whose endpoint maps the 3D panel should show right now.
    surfTracts() {
      if (this.tab === 'tract') return this.selectedTract ? [this.selectedTract] : [];
      if (this.tab === 'cluster' && this.activeCluster) return this.activeCluster.tracts;
      return [];
    },

    activeCluster() {
      return this.clusters.find(c => c.id === this.selectedCluster) || null;
    },

    filteredTracts() {
      const q = this.tractSearch.toLowerCase();
      if (!q) return this.tractOrder.slice().sort();
      return this.tractOrder.filter(t => t.toLowerCase().includes(q)).sort();
    },

    tractTopTopics() {
      if (!this.selectedTract || !this.matrix[this.selectedTract]) return [];
      const row = this.matrix[this.selectedTract];
      return Object.entries(row)
        .filter(([, v]) => v !== null && !isNaN(v))
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 15)
        .map(([topic, value]) => ({ topic, value }));
    },

    // Same shape as tractTopTopics, but for the selected cluster's own
    // decoding row (from cluster-matrix.csv — an independent re-decode of
    // the cluster's combined endpoint map, not an average of its tracts).
    clusterTopTopics() {
      if (!this.selectedCluster || !this.clusterMatrix[this.selectedCluster]) return [];
      const row = this.clusterMatrix[this.selectedCluster];
      return Object.entries(row)
        .filter(([, v]) => v !== null && !isNaN(v))
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 15)
        .map(([topic, value]) => ({ topic, value }));
    }
  },

  mounted() {
    if (!this.clustersEnabled) {
      this.sideMode = 'tracts';
      this.tab = 'tract';
    }
    this.loadData();
    this.loadTopicTerms();
  },

  beforeDestroy() {
    this.disposeSurfScenes();
  },

  watch: {
    // Any change to what's being viewed refreshes the 3D endpoint map.
    // queueSurfRefresh() dedups watchers that fire in the same tick
    // (e.g. selectTract() sets selectedTract and tab together).
    selectedTract(newVal) {
      if (this.tab !== 'tract') return;
      if (!newVal) { this.disposeSurfScenes(); return; }
      this.queueSurfRefresh();
    },
    selectedCluster(newVal) {
      if (this.tab === 'cluster' && newVal) this.queueSurfRefresh();
    },
    // Cluster membership is rebuilt whenever matrix.csv (re)loads, possibly
    // after a cluster is already selected — redraw once it lands.
    clusters() {
      if (this.tab === 'cluster' && this.selectedCluster) this.queueSurfRefresh();
    },
    tab(newTab) {
      if ((newTab === 'tract' && this.selectedTract) || (newTab === 'cluster' && this.selectedCluster)) {
        this.queueSurfRefresh();
      } else {
        this.disposeSurfScenes();
      }
    }
  },

  methods: {
    onThresholdChange() {
      // The loading panel below unmounts the Tract View's canvases, so release
      // the old WebGL scenes now; refreshTractSurfaces() recreates them on the
      // new canvases once the threshold's data has loaded.
      this.disposeSurfScenes();
      this.loading = true;
      this.selectedCluster = null;
      // selectedTract is intentionally left alone here — if the user was
      // viewing a tract, loadData()'s complete callback below keeps that
      // same tract selected under the new threshold instead of reverting
      // to the cluster view. Cluster selection always resets, since cluster
      // IDs/membership aren't comparable across different thresholds' own
      // clustering solutions.
      // If new threshold has no clustering, switch to tract mode/view
      if (!this.clustersEnabled) {
        this.sideMode = 'tracts';
        this.tab = 'tract';
      }
      this.loadData();
    },

    loadData() {
      const url = `${this.baseUrl}/matrix.csv`;
      Papa.parse(url, {
        download: true,
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (results) => {
          this.parseMatrix(results);
          this.loading = false;
          this.loadClusterMatrix();
          this.loadSideMatrices();

          // A tract the user had selected might not exist under this
          // threshold's data (shouldn't normally happen — all thresholds
          // share the same 51 tracts — but fall back safely if it does).
          if (this.selectedTract && !this.tractOrder.includes(this.selectedTract)) {
            this.selectedTract = null;
          }

          if (this.tab === 'tract' && this.selectedTract) {
            // Keep showing the tract already selected; just refresh the
            // live 3D surface panel for the new threshold's own data.
            this.queueSurfRefresh();
          } else if (this.clustersEnabled && this.clusters.length > 0) {
            this.selectCluster(this.clusters[0].id);
          }
        },
        error: (err) => {
          console.error('Failed to load matrix CSV:', err);
          this.loading = false;
        }
      });
    },

    parseMatrix(results) {
      const rows = results.data;
      if (!rows.length) return;

      const allCols = results.meta.fields;
      const tractCol = allCols[0];
      const topicCols = allCols.slice(1);

      this.topics = topicCols;
      this.tractOrder = [];
      this.matrix = {};
      let allValues = [];

      rows.forEach(row => {
        const tractName = row[tractCol];
        if (!tractName) return;
        this.tractOrder.push(tractName);
        this.matrix[tractName] = {};
        topicCols.forEach(t => {
          const raw = row[t];
          const v = (raw === 'NaN' || raw === '' || raw === undefined) ? null : parseFloat(raw);
          this.matrix[tractName][t] = v;
          if (v !== null && !isNaN(v)) allValues.push(v);
        });
      });

      allValues.sort((a, b) => a - b);
      const lo = Math.floor(allValues.length * 0.05);
      const hi = Math.ceil(allValues.length * 0.95);
      this.vmin = allValues[lo] ?? -0.5;
      this.vmax = allValues[hi] ?? 0.5;

      this.buildClusters();
    },

    // Clusters are computed live from matrix.csv (see cluster.js) with the
    // notebook's method: complete linkage on 1 − Pearson r, cut at
    // thresholdCfg.cut (default 1.0). Numbering matches scipy's fcluster,
    // i.e. the cluster ids used in cluster-matrix.csv and the N_surf.png figures.
    buildClusters() {
      const cut = this.thresholdCfg.cut ?? 1.0;
      const res = computeClustering(this.matrix, this.tractOrder, this.topics, cut);
      this.clustering = res ? Object.freeze(res) : null;   // frozen: no deep reactivity needed
      if (!res) {
        this.numClusters = 0; this.membershipKnown = false; this.clusters = [];
        this.rebuildAssignments();
        return;
      }
      const byCluster = {};
      res.tracts.forEach(t => { (byCluster[res.assignments[t]] = byCluster[res.assignments[t]] || []).push(t); });
      this.numClusters = res.numClusters;
      this.membershipKnown = true;
      this.clusters = Object.keys(byCluster).map(Number).sort((a, b) => a - b).map(id => ({
        id,
        color: CLUSTER_COLORS[(id - 1) % CLUSTER_COLORS.length],
        tracts: byCluster[id]
      }));
      this.rebuildAssignments();
      this.afterClustersBuilt();
    },

    // On first load the cluster list isn't ready when loadData() finishes,
    // so pick the first cluster here if the Cluster View is showing nothing.
    afterClustersBuilt() {
      if (this.tab === 'cluster' && this.clusters.length &&
          !this.clusters.some(c => c.id === this.selectedCluster)) {
        this.selectCluster(this.clusters[0].id);
      }
    },

    rebuildAssignments() {
      this.clusterAssignments = {};
      this.clusters.forEach(c => {
        c.tracts.forEach(t => { this.clusterAssignments[t] = c.id; });
      });
    },

    selectCluster(id) {
      this.selectedCluster = id;
      this.tab = 'cluster';
      this.sideMode = 'clusters';
    },

    selectTract(name) {
      this.selectedTract = name;
      this.tab = 'tract';
    },

    // "Tract View" / "Cluster View" top tabs also flip the sidebar into the
    // matching mode, so the tract/cluster list is actually visible right away
    // instead of leaving the user on an empty-state with no list in sight.
    showTractView() {
      this.tab = 'tract';
      this.sideMode = 'tracts';
    },

    showClusterView() {
      this.tab = 'cluster';
      this.sideMode = 'clusters';
      this.afterClustersBuilt();   // nothing selected yet → show the first cluster
    },

    selectTractAndSwitch(name) {
      this.selectedTract = name;
      this.sideMode = 'tracts';
      this.tab = 'tract';
    },

    jumpToCluster(id) {
      this.selectedCluster = id;
      this.sideMode = 'clusters';
      this.tab = 'cluster';
    },

    cellColor(tract, topic) {
      const v = this.matrix[tract]?.[topic] ?? null;
      return scoreToColor(v, this.vmin, this.vmax);
    },

    tractClusterColor(tract) {
      const cIdx = this.clusterAssignments[tract];
      if (!cIdx) return '#555';
      return CLUSTER_COLORS[(cIdx - 1) % CLUSTER_COLORS.length];
    },

    tractClusterIndex(tract) {
      return this.clusterAssignments[tract] || '–';
    },

    topicLabel(raw) { return topicLabel(raw); },
    topicId(raw) { return String(raw).split('_')[0]; },
    fmtR(v) { return v === null || v === undefined || isNaN(v) ? '—' : v.toFixed(3); },
    sideBarWidth(v) { return (Math.abs(v) / this.sideBarMax) * 96; },
    // matrix_RAS.csv / matrix_LPI.csv: each endpoint decoded on its own
    // (same layout as matrix.csv). Missing file → that column says "no data".
    loadSideMatrices() {
      ['RAS', 'LPI'].forEach(side => {
        const key = 'matrix' + side;
        this[key] = {};
        Papa.parse(`${this.baseUrl}/matrix_${side}.csv`, {
          download: true, header: true, skipEmptyLines: true,
          complete: (results) => {
            const fields = results.meta.fields || [];
            if (!fields.length) return;
            const out = {};
            results.data.forEach(row => {
              const tract = row[fields[0]];
              if (!tract) return;
              out[tract] = {};
              fields.slice(1).forEach(t => {
                const raw = row[t];
                out[tract][t] = (raw === 'NaN' || raw === '' || raw === undefined) ? null : parseFloat(raw);
              });
            });
            this[key] = Object.freeze(out);
          },
          error: () => { /* no per-endpoint file for this threshold */ }
        });
      });
    },
    toggleTopic(topic) { this.selectedTopic = this.selectedTopic === topic ? null : topic; },
    termClassCss(c) { return 'tc-' + String(c).toLowerCase().replace(/[^a-z]/g, ''); },
    termClassShort(c) { return String(c).charAt(0).toUpperCase(); },
    loadTopicTerms() {
      const url = this.config.topicTermsUrl || 'assets/decoding/topic-terms.json';
      fetch(url)
        .then(r => (r.ok ? r.json() : null))
        .then(d => { this.topicTerms = Object.freeze((d && d.topics) || {}); })
        .catch(() => { this.topicTerms = {}; });
    },

    // Scale bar width: largest |value| = 100%, maintain sign split at 50%
    barWidth(v) {
      const maxAbs = this.tractTopTopics.length
        ? Math.max(...this.tractTopTopics.map(x => Math.abs(x.value)))
        : 1;
      return maxAbs > 0 ? (Math.abs(v) / maxAbs) * 96 : 0;
    },

    showTip(event, tract, topic) {
      const v = this.matrix[tract]?.[topic] ?? null;
      this.tooltip = {
        visible: true,
        x: event.clientX + 14,
        y: event.clientY - 10,
        tract, topic, value: v
      };
    },
    hideTip() { this.tooltip.visible = false; },

    // Optional cluster-matrix.csv alongside matrix.csv — one row per cluster
    // (independent re-decode of that cluster's combined endpoint map), same
    // 104 topic columns as the tract matrix. Missing file just means this
    // threshold hasn't had its cluster decoding exported/copied in yet.
    loadClusterMatrix() {
      this.clusterMatrix = {};
      const url = `${this.baseUrl}/cluster-matrix.csv`;
      Papa.parse(url, {
        download: true,
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors && results.errors.length && !results.data.length) return; // no file
          const fields = results.meta.fields || [];
          const clusterCol = fields[0];
          const topicCols = fields.slice(1);
          const byCluster = {};
          results.data.forEach(row => {
            const id = parseInt(row[clusterCol], 10);
            if (!id) return;
            byCluster[id] = {};
            topicCols.forEach(t => {
              const raw = row[t];
              byCluster[id][t] = (raw === 'NaN' || raw === '' || raw === undefined) ? null : parseFloat(raw);
            });
          });
          this.clusterMatrix = byCluster;
        },
        error: () => { /* cluster-matrix.csv not present for this threshold — fine, panel just hides */ }
      });
    },

    // Scale bar width for the cluster topic bars, same convention as barWidth() above.
    clusterBarWidth(v) {
      const maxAbs = this.clusterTopTopics.length
        ? Math.max(...this.clusterTopTopics.map(x => Math.abs(x.value)))
        : 1;
      return maxAbs > 0 ? (Math.abs(v) / maxAbs) * 96 : 0;
    },

    clusterCellColor(clusterId, topic) {
      const v = this.clusterMatrix[clusterId]?.[topic] ?? null;
      return scoreToColor(v, this.vmin, this.vmax);
    },

    showClusterTip(event, clusterId, topic) {
      const v = this.clusterMatrix[clusterId]?.[topic] ?? null;
      this.tooltip = {
        visible: true,
        x: event.clientX + 14,
        y: event.clientY - 10,
        tract: `Cluster ${clusterId}`, topic, value: v
      };
    },

    // ── 3D cortical endpoint map (Tract View) ──────────────────────
    // Lazily creates the two SurfaceScene instances (RAS/LPI canvases)
    // the first time they're needed; reused across tract selections.
    ensureSurfScenes() {
      if (!this.surfMeshBase || this._webglFailed) return;
      try {
        // The Tract View (and its <canvas> elements) is torn down and rebuilt
        // by Vue whenever the "Loading data…" panel shows (e.g. on a threshold
        // change). A scene bound to a canvas that's no longer in the DOM would
        // render invisibly, so drop it and rebind to the current canvas.
        if (this._surfRAS && this._surfRAS.canvas !== this.$refs.surfCanvasRAS) { this._surfRAS.dispose(); this._surfRAS = null; }
        if (this._surfLPI && this._surfLPI.canvas !== this.$refs.surfCanvasLPI) { this._surfLPI.dispose(); this._surfLPI = null; }
        if (!this._surfRAS && this.$refs.surfCanvasRAS) this._surfRAS = new SurfaceScene(this.$refs.surfCanvasRAS);
        if (!this._surfLPI && this.$refs.surfCanvasLPI) this._surfLPI = new SurfaceScene(this.$refs.surfCanvasLPI);
      } catch (err) {
        // e.g. WebGL unavailable/disabled — fail soft instead of breaking the page.
        console.error('3D surface view unavailable (WebGL failed to initialize):', err);
        this._webglFailed = true;
        this.surfStatus.RAS = 'nowebgl';
        this.surfStatus.LPI = 'nowebgl';
        this.disposeSurfScenes();
      }
    },

    disposeSurfScenes() {
      // Invalidate any in-flight request too, so a slow response that resolves
      // after disposal can't call setHemiMesh() on scenes that no longer exist.
      this._surfRequestId = (this._surfRequestId || 0) + 1;
      if (this._surfRAS) { this._surfRAS.dispose(); this._surfRAS = null; }
      if (this._surfLPI) { this._surfLPI.dispose(); this._surfLPI = null; }
    },

    // Collapses multiple watcher-triggered refresh requests landing in the
    // same tick into a single actual refresh (see the `watch` block above).
    queueSurfRefresh() {
      if (this._surfRefreshQueued) return;
      this._surfRefreshQueued = true;
      this.$nextTick(() => {
        this._surfRefreshQueued = false;
        this.refreshTractSurfaces();
      });
    },

    refreshTractSurfaces() {
      if (!this.surfBase || !this.surfMeshBase) return;
      if (this.tab === 'tract' && !this.selectedTract) return;
      if (this.tab === 'cluster' && !this.activeCluster) return;
      this.ensureSurfScenes();
      if (this._webglFailed) return;
      if (!this.surfTracts.length) {
        // Cluster selected, but its member tracts are unknown for this threshold.
        this.disposeSurfScenes();
        this.surfStatus.RAS = 'nomembers';
        this.surfStatus.LPI = 'nomembers';
        return;
      }
      // Bump the request generation so an in-flight fetch from a threshold/tract
      // we've since navigated away from can recognize itself as stale and
      // discard its result instead of overwriting whatever loaded after it —
      // tract selection alone isn't a reliable staleness signal here, since
      // the same tract can stay selected across a threshold switch.
      const requestId = (this._surfRequestId = (this._surfRequestId || 0) + 1);
      if (this.tab === 'cluster') {
        // One combined view: both orientations merged into the single canvas.
        this.loadTractSurface('RAS', requestId, ['RAS', 'LPI']);
      } else {
        ['RAS', 'LPI'].forEach(orient => this.loadTractSurface(orient, requestId));
      }
    },

    // Fetches lh/rh func.gii for the given orientation for every tract in
    // surfTracts (one tract in Tract View, all member tracts in Cluster View),
    // colours the shared fsaverage mesh with them and drops them into the
    // scene. For a cluster, member maps are combined as the per-vertex MAX,
    // i.e. the union of the cluster's endpoint territory. manifest.json (when
    // present) limits requests to hemi/orientation combos that exist.
    // `orient` picks the canvas/status slot; `sourceOrients` lists which
    // orientations' files feed it (Cluster View merges RAS + LPI into one).
    loadTractSurface(orient, requestId, sourceOrients = [orient]) {
      const scene = orient === 'RAS' ? this._surfRAS : this._surfLPI;
      const isCluster = this.tab === 'cluster';
      const stops = isCluster ? clusterRamp(this.activeCluster.color) : null;
      const colorFn = stops ? (t => rampRgb01(stops, 0.25 + 0.75 * t)) : null;
      if (!scene) return;
      const tracts = this.surfTracts.slice();
      const label = tracts.length === 1 ? tracts[0] : `cluster ${this.selectedCluster}`;
      const surfBase = this.surfBase;
      const meshBase = this.surfMeshBase;

      this.surfStatus[orient] = 'loading';
      scene.clearHemi('lh');
      scene.clearHemi('rh');

      loadSurfManifest(surfBase).then(manifest => {
        return Promise.all(['lh', 'rh'].map(hemi => {
          const wanted = [];   // [tract, orientation] pairs that exist
          tracts.forEach(t => sourceOrients.forEach(o => {
            if (!manifest || (manifest[t] && manifest[t][hemi] && manifest[t][hemi].includes(o))) wanted.push([t, o]);
          }));
          if (!wanted.length) return null;
          return Promise.all([
            loadHemiMesh(meshBase, hemi),
            Promise.all(wanted.map(([t, o]) =>
              fetchGifti(`${surfBase}/${hemi}.${t}.${o}.func.gii`).catch(() => null)
            ))
          ]).then(([mesh, perTract]) => {
            let overlay = null;
            perTract.forEach(arrays => {
              if (!arrays || !arrays.length) return;
              const d = (arrays.find(a => a.dim0 === mesh.nVerts) || arrays[0]).values;
              if (!overlay) { overlay = Float32Array.from(d); return; }
              for (let i = 0; i < overlay.length; i++) if (d[i] > overlay[i]) overlay[i] = d[i];
            });
            return overlay ? { hemi, mesh, overlay } : null;
          });
        }));
      }).then(results => {
        // A newer refresh (tract OR threshold change) has started since this
        // request went out — drop this result rather than risk a slow old
        // response overwriting what the newer request already loaded.
        if (requestId !== this._surfRequestId) return;
        const found = results.filter(Boolean);
        if (!found.length) { this.surfStatus[orient] = 'empty'; return; }

        let max = 0;
        found.forEach(f => {
          for (let i = 0; i < f.overlay.length; i++) if (f.overlay[i] > max) max = f.overlay[i];
        });
        found.forEach(f => {
          scene.setHemiMesh(f.hemi, buildColoredGeometry(f.mesh, f.overlay, max, colorFn));
        });
        scene.setDefaultView(found.map(f => f.hemi));
        this.surfMax[orient] = max;
        this.surfStatus[orient] = 'ready';
      }).catch(err => {
        console.error(`Failed to load ${orient} surface for ${label}:`, err);
        if (requestId === this._surfRequestId) this.surfStatus[orient] = 'empty';
      });
    }
  }
});
