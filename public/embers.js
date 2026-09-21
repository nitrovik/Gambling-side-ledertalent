(function () {
  const container = document.querySelector('.embers');
  if (!container) return;
  const configs = [
    [4, 0, 7.5], [12, 1.1, 6.2], [20, 2.3, 8.1], [29, 0.4, 6.8],
    [38, 1.8, 7.2], [47, 3.0, 6.5], [55, 0.9, 8.4], [63, 2.6, 6.9],
    [71, 1.4, 7.7], [79, 3.4, 6.3], [87, 0.2, 8.0], [94, 2.0, 7.0],
  ];
  container.innerHTML = configs.map(([left, delay, duration]) => (
    `<span style="left:${left}%; animation-delay:${delay}s; animation-duration:${duration}s;"></span>`
  )).join('');
})();
