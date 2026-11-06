const grid = document.getElementById('grid');
document.getElementById('count').textContent = `${TOOLS.length} 个工具`;

for (const t of TOOLS) {
  const item = document.createElement('button');
  item.className = 'tool';
  item.innerHTML = `<span class="icon">${t.icon}</span><span class="meta"><span class="name"></span><span class="desc"></span></span>`;
  item.querySelector('.name').textContent = t.name;
  item.querySelector('.desc').textContent = t.desc;
  item.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL(t.path) });
  grid.appendChild(item);
}
