import { chromium, Browser } from 'playwright';

async function testMedicineLinks() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('Loading NHS medicines page...');
    await page.goto('https://www.nhs.uk/medicines/', { waitUntil: 'networkidle' });
    
    // Try to dismiss cookie banner
    try {
      const cookieButton = await page.$('button:has-text("Accept"), button:has-text("Accept all"), button:has-text("I accept")');
      if (cookieButton) {
        await cookieButton.click();
        await page.waitForTimeout(1000);
      }
    } catch (error) {
      // Cookie banner might not be present
    }
    
    const result = await page.evaluate(() => {
      // 1) Find medicine links on the page
      const anchors = Array.from(document.querySelectorAll('a[href]'));

      // Only links with a non-empty path after "/medicines/"
      const isMed = (a: Element) => {
        const href = a.getAttribute('href');
        if (!href) return false;
        const url = new URL(href, location.href);
        const idx = url.pathname.indexOf('/medicines/');
        if (idx === -1) return false;
        const tail = url.pathname.slice(idx + '/medicines/'.length);
        return !!tail && tail !== '/' && !tail.startsWith('#');
      };

      // 2) Normalize & de-dupe
      const set = new Map(); // key: absolute URL
      anchors.filter(isMed).forEach(a => {
        const url = new URL(a.getAttribute('href')!, location.href).href;
        const name = (a.textContent || '').trim().replace(/\s+/g, ' ');
        
        // Filter out unwanted entries
        const isValid = name !== 'Medicines A to Z' && 
                       !name.includes('Overview -') &&
                       !name.includes('see ') &&
                       name.length > 1 &&
                       name.length < 100;
        
        // keep the first non-empty name we see
        if (isValid && (!set.has(url) || (!set.get(url).name && name))) {
          set.set(url, { name: name || null, url });
        }
      });

      const data = [...set.values()];
      return { count: data.length, data };
    });
    
    console.log(`✅ Found ${result.count} medicine links`);
    console.log('First 10 medicines:');
    result.data.slice(0, 10).forEach((medicine: any, index: number) => {
      console.log(`${index + 1}. ${medicine.name}`);
    });
    
    console.log('\nLast 10 medicines:');
    result.data.slice(-10).forEach((medicine: any, index: number) => {
      console.log(`${result.count - 9 + index}. ${medicine.name}`);
    });
    
    return result;
    
  } finally {
    await browser.close();
  }
}

testMedicineLinks().catch(console.error);
