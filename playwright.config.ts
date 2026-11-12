import { defineConfig,devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:60000,
  // The disposable preview also compiles routes on first access.
  expect:{timeout:30000},
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure'},
  webServer:{command:'npm run dev:preview -- --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:false,timeout:120000},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1366,height:900}}},{name:'tablet',use:{...devices['Desktop Chrome'],viewport:{width:768,height:1024}}}]
});
