export async function showBoilTree(page) {
  if (!(await page.locator('.boil-panel').isVisible())) await page.locator('.boil-panel-toggle').click();
}

export async function clickBoilEquipment(page, id) {
  await showBoilTree(page);
  await page.locator('[data-equipment-row="' + id + '"]').click();
}

export async function pickBoilOption(page, selector) {
  const more = page.locator('.boil-more');
  if (await more.getAttribute('open') === null) await more.locator('summary').click();
  await page.locator(selector).click();
  if (await more.getAttribute('open') !== null) await more.locator('summary').click();
}
