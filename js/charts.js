// Shared Chart.js config defaults and helpers

export const chartDefaults = {
  font: { family: 'Jost', size: 11 },
  color: '#a8a49e',
};

const charts = {};

export function destroyChart(name) {
  if (charts[name]) { charts[name].destroy(); delete charts[name]; }
}

export function storeChart(name, instance) {
  charts[name] = instance;
}

export function getChart(name) {
  return charts[name] || null;
}
