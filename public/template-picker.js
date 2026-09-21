import { TEMPLATES, getTemplate, buildPrompt } from './templates.js';
import { icon } from './shell.js';

export function mountTemplatePicker({ onClose = () => {} } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'template-picker'; dialog.setAttribute('aria-labelledby', 'pickerTitle');
  dialog.innerHTML = `<header class="picker-header"><div><p class="eyebrow">CREATE A WEB AGENT</p><h2 id="pickerTitle">Start with a template</h2><p id="pickerDescription">Explore a use case, preview the prompt, then make it yours.</p></div><button type="button" class="icon-button picker-close" aria-label="Close template picker">×</button></header>
    <div class="picker-toolbar"><label class="picker-search"><span>${icon('grid')}</span><input type="search" id="templateSearch" aria-label="Search templates" placeholder="Search templates"></label><a class="button outlined" href="/agents/new?template=custom">Write my own prompt ${icon('arrow')}</a></div>
    <div class="picker-body"><nav class="picker-categories" aria-label="Template categories"></nav><section class="picker-results" aria-label="Available templates"><div class="picker-results-heading"><h3 id="pickerCategory">All templates</h3><span id="pickerCount" role="status"></span></div><div class="picker-grid"></div><p class="picker-empty" hidden>No templates match your search. Try a different term or category.</p></section></div>
    <section class="picker-preview" hidden><button type="button" class="text-button picker-back">← Back to templates</button><div class="picker-preview-layout"><div><span class="template-icon" id="pickerPreviewIcon"></span><p class="eyebrow" id="pickerPreviewSector"></p><h3 id="pickerPreviewName"></h3><p id="pickerPreviewDescription"></p><h4>Conversation objective</h4><p id="pickerPreviewGoal"></p><h4>Decision signals</h4><div class="signal-chips" id="pickerPreviewSignals"></div><h4 id="pickerPreviewStagesTitle"></h4><ol class="preview-stages" id="pickerPreviewStages"></ol></div><div class="picker-prompt"><h4>Starting system prompt</h4><p>Editable in the next step.</p><pre id="pickerPrompt" tabindex="0" aria-label="Template system prompt"></pre></div></div></section>
    <footer class="picker-footer"><span id="pickerFooter">${TEMPLATES.length} templates · Editable prompts and decision playbooks</span><button class="text-button picker-cancel" type="button">Cancel</button><a class="button primary" id="useTemplate" hidden>Use this template ${icon('arrow')}</a></footer>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  let category = 'All templates';
  const groups = [
    ['Business functions', ['Sales & growth', 'Customer service', 'IT & operations']],
    ['Industries', ['Logistics', 'Hospitality', 'Field service']],
  ];
  function categoryButton(label, count, glyph) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.category = label;
    button.innerHTML = `${icon(glyph)}<span></span><small>${count}</small>`;
    button.querySelector('span').textContent = label;
    button.onclick = () => { category = label; render(); };
    return button;
  }
  const categories = find('.picker-categories');
  categories.append(categoryButton('All templates', TEMPLATES.length, 'grid'));
  for (const [group, sectors] of groups) {
    const heading = document.createElement('h3'); heading.textContent = group; categories.append(heading);
    for (const sector of sectors) {
      const matching = TEMPLATES.filter(template => template.sector === sector);
      if (matching.length) categories.append(categoryButton(sector, matching.length, matching[0].icon));
    }
  }
  function render() {
    const term = find('#templateSearch').value.trim().toLowerCase();
    const matches = TEMPLATES.filter(template => (category === 'All templates' || template.sector === category) && `${template.name} ${template.sector} ${template.description}`.toLowerCase().includes(term));
    find('#pickerCategory').textContent = category;
    find('#pickerCount').textContent = `${matches.length} ${matches.length === 1 ? 'template' : 'templates'}`;
    categories.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
    find('.picker-grid').replaceChildren(...matches.map(template => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'template-card'; button.dataset.accent = template.accent;
      button.innerHTML = `<span class="picker-card-category">${icon(template.icon)}<span></span></span><h3></h3><p></p><span class="template-bottom">Preview template ${icon('arrow')}</span>`;
      button.querySelector('.picker-card-category span').textContent = template.sector;
      button.querySelector('h3').textContent = template.name;
      button.querySelector('p').textContent = template.description;
      button.onclick = () => preview(template.id); return button;
    }));
    find('.picker-empty').hidden = matches.length > 0;
  }
  function list() {
    find('.picker-preview').hidden = true; find('.picker-body').hidden = find('.picker-toolbar').hidden = false;
    find('#useTemplate').hidden = true; find('.picker-cancel').hidden = false;
    find('#pickerTitle').textContent = 'Start with a template';
    find('#pickerDescription').textContent = 'Explore a use case, preview the prompt, then make it yours.';
    find('#pickerFooter').textContent = `${TEMPLATES.length} templates · Editable prompts and decision playbooks`;
    render();
  }
  function preview(id) {
    const template = getTemplate(id);
    if (!template) return;
    find('.picker-body').hidden = find('.picker-toolbar').hidden = true; find('.picker-preview').hidden = false;
    find('#pickerTitle').textContent = 'Preview template'; find('#pickerDescription').textContent = 'A starting point for your agent, ready to personalize.';
    find('#pickerPreviewIcon').innerHTML = icon(template.icon);
    for (const [field, value] of Object.entries({ Sector: template.sector, Name: template.name, Description: template.description, Goal: template.goal, StagesTitle: template.stageLabel })) find('#pickerPreview' + field).textContent = value;
    find('#pickerPreviewSignals').replaceChildren(...template.signals.map(label => Object.assign(document.createElement('span'), { textContent: label })));
    find('#pickerPreviewStages').replaceChildren(...template.stages.map(label => Object.assign(document.createElement('li'), { textContent: label })));
    find('#pickerPrompt').textContent = buildPrompt(template);
    find('#useTemplate').href = '/agents/new?template=' + encodeURIComponent(id); find('#useTemplate').hidden = false;
    find('.picker-cancel').hidden = true; find('#pickerFooter').textContent = 'Next: add your company context, prompt, and voice.';
    find('.picker-preview').scrollTop = 0; find('.picker-back').focus();
  }
  find('.picker-back').onclick = () => { list(); find('#templateSearch').focus(); };
  find('#templateSearch').oninput = render;
  find('.picker-close').onclick = find('.picker-cancel').onclick = () => dialog.close();
  dialog.addEventListener('close', onClose);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  return { open(id) { category = 'All templates'; find('#templateSearch').value = ''; list(); dialog.showModal(); if (id) preview(id); else find('#templateSearch').focus(); } };
}
