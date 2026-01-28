export const orchestratorOptions = {
  normalizeVisualforceFrame: true,
};

export async function runTaskOrchestrator(page) {
  const routes = [
    {
      name: 'Lightning App Launcher abierto',
      check: async () => await isAppLauncherOpen(page),
      run: async () => {
        await page.waitForTimeout(250);
      },
    },
    {
      name: 'Abrir App Launcher si está disponible',
      check: async () => await hasAppLauncherButton(page),
      run: async () => {
        const launcherButton = page.getByRole('button', {name: 'App Launcher'});
        await launcherButton.first().click({timeout: 5000});
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'Esperar buscador del App Launcher',
      check: async () => await hasAppLauncherSearch(page),
      run: async () => {
        await page.getByRole('combobox', {name: 'Search apps and items...'}).waitFor({timeout: 10000});
      },
    },
    {
      name: 'Esperar Visualforce para Maintenance Jobs',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await waitForMaintenanceJobsLink(page);
      },
    },
    {
      name: 'Click Maintenance Jobs en Visualforce',
      check: async () => await hasVisualforceFrame(page),
      run: async () => {
        await clickMaintenanceJobsLink(page);
      },
    },
  ];

  for (const route of routes) {
    const shouldRun = await route.check();
    if (shouldRun) {
      await route.run();
    }
  }
}

async function hasAppLauncherButton(page) {
  try {
    return (await page.getByRole('button', {name: 'App Launcher'}).count()) > 0;
  } catch (error) {
    return false;
  }
}

async function hasAppLauncherSearch(page) {
  try {
    return (await page.getByRole('combobox', {name: 'Search apps and items...'}).count()) > 0;
  } catch (error) {
    return false;
  }
}

async function isAppLauncherOpen(page) {
  try {
    return await page
      .getByRole('combobox', {name: 'Search apps and items...'})
      .isVisible({timeout: 1000});
  } catch (error) {
    return false;
  }
}

async function hasVisualforceFrame(page) {
  try {
    return (await page.locator('iframe[name^="vfFrameId_"]').count()) > 0;
  } catch (error) {
    return false;
  }
}

async function waitForMaintenanceJobsLink(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  await vf.getByRole('link', {name: 'Maintenance Jobs'}).waitFor({timeout: 15000});
}

async function clickMaintenanceJobsLink(page) {
  const frameLocator = page.locator('iframe[name^="vfFrameId_"]').first();
  await frameLocator.waitFor({timeout: 15000});
  const vf = await frameLocator.contentFrame();
  if (!vf) {
    return;
  }
  const link = vf.getByRole('link', {name: 'Maintenance Jobs'});
  await link.waitFor({timeout: 15000});
  try {
    await link.click({timeout: 5000});
  } catch (error) {
    await vf.page().waitForTimeout(1000);
    await link.click({timeout: 5000});
  }
}
