import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs-extra';
import * as path from 'path';
import { MedicineInfo, ScrapingResult, ScrapingOptions, Section, MedicineSection } from './types';

export class NHSMedicineScraper {
  private browser: Browser | null = null;
  private options: ScrapingOptions;
  private startTime: number = 0;
  private medicineStartTime: number = 0;
  private processedCount: number = 0;
  private wordList: Set<string> = new Set();

  constructor(options: ScrapingOptions = {}) {
    this.options = {
      concurrency: 3,
      delay: 1000,
      timeout: 30000,
      testMode: false,
      limit: 0,
      ...options
    };
  }

  async initialize(): Promise<void> {
    console.log('Initializing browser...');
    this.browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    // Load word list for smart text cleaning
    await this.loadWordList();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async scrape(): Promise<ScrapingResult> {
    if (!this.browser) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }

    console.log('Starting NHS medicines scraping...');
    this.startTime = Date.now();
    console.log(`⏱️  Started at: ${new Date().toLocaleTimeString()}`);
    console.log(`📊 Concurrency: ${this.options.concurrency || 3} parallel requests`);
    console.log(`⏳ Delay between requests: ${this.options.delay || 1000}ms\n`);

    try {
      // Get all medicine links
      const medicineLinks = await this.getMedicineLinks();
      console.log(`Found ${medicineLinks.length} medicine links`);

      // Apply limit if specified
      const limit = this.options.limit || 0;
      const linksToProcess = limit > 0 
        ? medicineLinks.slice(0, limit)
        : medicineLinks;

      console.log(`Processing ${linksToProcess.length} medicines${limit > 0 ? ` (limited to ${limit})` : ''}...`);

      // Scrape medicines with concurrency control
      const medicines: MedicineInfo[] = [];
      const failedMedicines: string[] = [];
      const semaphore = new Semaphore(this.options.concurrency!);

      const scrapePromises = linksToProcess.map(async (link, index) => {
        await semaphore.acquire();
        try {
          this.medicineStartTime = Date.now();
          const medicine = await this.scrapeMedicineDetails(link);
          if (medicine) {
            medicines.push(medicine);
            
            this.processedCount++;
            const elapsed = Date.now() - this.startTime;
            const avgTimePerMedicine = elapsed / this.processedCount;
            const remaining = linksToProcess.length - this.processedCount;
            const estimatedTimeRemaining = remaining * avgTimePerMedicine;
            
            const progress = Math.round((this.processedCount / linksToProcess.length) * 100);
            const progressBar = this.createProgressBar(progress);
            console.log(`✓ Scraped: ${medicine.name} (${this.processedCount}/${linksToProcess.length}) ${progressBar} ${progress}% - ${this.formatTime(estimatedTimeRemaining)} remaining`);
          } else {
            failedMedicines.push(link.name);
            this.processedCount++;
            const progress = Math.round((this.processedCount / linksToProcess.length) * 100);
            const progressBar = this.createProgressBar(progress);
            console.log(`✗ Failed: ${link.name} (${this.processedCount}/${linksToProcess.length}) ${progressBar} ${progress}%`);
          }
        } finally {
          semaphore.release();
          if (this.options.delay && this.options.delay > 0) {
            await this.delay(this.options.delay);
          }
        }
      });

      await Promise.all(scrapePromises);

      const endTime = Date.now();
      const totalTime = endTime - this.startTime;
      const duration = totalTime / 1000;
      
      console.log(`\n⏱️  Total scraping time: ${this.formatTime(totalTime)}`);
      console.log(`📈 Average time per medicine: ${this.formatTime(totalTime / linksToProcess.length)}`);
      console.log(`🏁 Completed at: ${new Date().toLocaleTimeString()}`);

      const result: ScrapingResult = {
        totalMedicines: medicineLinks.length,
        scrapedMedicines: medicines.length,
        failedMedicines,
        medicines,
        scrapedAt: new Date().toISOString()
      };

      // Save results
      await this.saveResults(result);

      console.log(`\nScraping completed in ${duration.toFixed(2)} seconds`);
      console.log(`Successfully scraped: ${medicines.length}/${linksToProcess.length} medicines`);
      console.log(`Failed: ${failedMedicines.length} medicines`);
      console.log(`Results saved to: nhs-medicines.json`);

      return result;

    } catch (error) {
      console.error('Scraping failed:', error);
      throw error;
    }
  }

  private async getMedicineLinks(): Promise<{ name: string; url: string }[]> {
    if (!this.browser) throw new Error('Browser not initialized');

    const page = await this.browser.newPage();
    try {
      console.log('Loading NHS medicines page...');
      await page.goto('https://www.nhs.uk/medicines/', { 
        waitUntil: 'networkidle', 
        timeout: this.options.timeout 
      });

      // Dismiss cookie banner
      await this.dismissCookieBanner(page);

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

        return [...set.values()];
      });

      console.log(`✅ Found ${result.length} unique medicine links`);
      return result;

    } finally {
      await page.close();
    }
  }

  private async scrapeMedicineDetails(link: { name: string; url: string }): Promise<MedicineInfo | null> {
    if (!this.browser) throw new Error('Browser not initialized');

    try {
      const page = await this.browser.newPage();
      await page.goto(link.url, { waitUntil: 'networkidle', timeout: this.options.timeout });

      // Dismiss cookie banner
      await this.dismissCookieBanner(page);

      // Extract basic medicine information
      const medicineInfo = await page.evaluate(() => {
        const cleanText = (text: string | null | undefined): string | undefined => {
          if (!text) return undefined;
          return text
            .replace(/\u00A0/g, ' ') // Replace non-breaking spaces with regular spaces
            .replace(/–/g, ' ') // Replace en dash with space
            .replace(/—/g, ' ') // Replace em dash with space
            .replace(/([.!?:])([A-Z])/g, '$1 $2') // Add space after periods/bangs/questions/colons before capital letters
            .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between lowercase and uppercase letters
            .replace(/([a-z])(\d)/g, '$1 $2') // Add space between letters and numbers
            .replace(/(\d)([A-Z])/g, '$1 $2') // Add space between numbers and capital letters
            .replace(/([a-z])([a-z][a-z][a-z]+)/g, (match, p1, p2) => {
              // Fix concatenated words like "cold soresgenital herpeseye infections"
              // Look for patterns where lowercase letters are followed by longer lowercase words
              if (p2.length >= 4 && p2.charAt(0) === p2.charAt(0).toLowerCase()) {
                // Check if this looks like separate words (common medical terms)
                const commonWords = ['cold', 'genital', 'eye', 'skin', 'oral', 'nasal', 'ear', 'hand', 'foot', 'back', 'chest', 'head', 'neck', 'arm', 'leg'];
                for (const word of commonWords) {
                  if (p2.toLowerCase().startsWith(word)) {
                    return p1 + ' ' + p2;
                  }
                }
              }
              return match;
            })
            .replace(/cold soresgenital herpeseye infections/g, 'cold sores genital herpes eye infections')
            .replace(/cold soresgenital herpes/g, 'cold sores genital herpes')
            .replace(/genital herpeseye infections/g, 'genital herpes eye infections')
            .replace(/medicinehave/g, 'medicine have')
            .replace(/y ears/g, 'years')
            .replace(/oldare/g, 'old are')
            .replace(/problemsare/g, 'problems are')
            .replace(/breastfeeding\./g, 'breastfeeding.')
      .replace(/:([a-z])/g, ': $1') // Add space after colon before lowercase letters
            .replace(/:([a-z])/g, ': $1') // Add space after colon before lowercase letters
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();
        };

        // Get medicine name (without brand names)
        const nameElement = document.querySelector('h1, .nhsuk-heading-xl');
        let name = cleanText(nameElement?.textContent) || 'Unknown Medicine';
        
        // Remove brand names from the title if present (handle both - and –)
        if (name.includes(' - ') || name.includes(' – ')) {
          name = name.split(/ - | – /)[0].trim();
        }

        // Get other brand names
        const brandElement = document.querySelector('.nhsuk-caption-xl');
        let otherBrandNames = cleanText(brandElement?.textContent);
        if (otherBrandNames && otherBrandNames.startsWith('- Other brand names: ')) {
          otherBrandNames = otherBrandNames.replace('- Other brand names: ', '');
        } else if (otherBrandNames && otherBrandNames.startsWith('- Brand name: ')) {
          otherBrandNames = otherBrandNames.replace('- Brand name: ', '');
        }

        // Set the date and time when this data was captured
        const dateCaptured = new Date().toISOString();

        // Get summary from the first meaningful paragraph on the page
        const mainParagraphs = document.querySelectorAll('main p, .nhsuk-main-wrapper p, .nhsuk-width-container p');
        let summary = '';
        
        for (const p of Array.from(mainParagraphs)) {
          const text = cleanText(p.textContent);
          if (text && text.length > 50 && 
              !text.includes('cookies') &&
              !text.includes('analytics') &&
              !text.includes('We\'ve put some small files') &&
              !text.includes('Page last reviewed') &&
              !text.includes('Next review due')) {
            summary = text;
            break;
          }
        }
        
        // Fallback to meta description if no paragraph found
        if (!summary) {
          const metaDescription = document.querySelector('meta[name="description"]');
          summary = cleanText(metaDescription?.getAttribute('content')) || '';
        }


        // Get related conditions
        const relatedConditions: string[] = [];
        const conditionLinks = document.querySelectorAll('a[href*="/conditions/"]');
        conditionLinks.forEach(link => {
          const text = cleanText(link.textContent);
          if (text && text.length > 0 && text.length < 50) {
            relatedConditions.push(text);
          }
        });

        return {
          name,
          otherBrandNames,
          dateCaptured,
          summary,
          relatedConditions: [...new Set(relatedConditions)] // Remove duplicates
        };
      });



      // Get section links
      const sectionLinks = await this.getSectionLinks(link.url);
      
      // Initialize medicine info with basic data
      const medicine: MedicineInfo = {
        name: medicineInfo.name,
        url: link.url,
        dateCaptured: medicineInfo.dateCaptured,
        otherBrandNames: medicineInfo.otherBrandNames,
        summary: this.enhanceGrammar(medicineInfo.summary || ''),
        about: { sections: [], url: sectionLinks.about },
        eligibility: { sections: [], url: sectionLinks.whoCanTake },
        howAndWhenToTake: { sections: [], url: sectionLinks.howAndWhenToTake },
        sideEffects: { sections: [], url: sectionLinks.sideEffects },
        pregnancyBreastFeedingFertility: { sections: [], url: sectionLinks.pregnancy },
        takingWithOther: { sections: [], url: sectionLinks.interactions },
        commonQuestions: { sections: [], url: sectionLinks.commonQuestions },
        relatedConditions: medicineInfo.relatedConditions
      };

      await page.close();

      // Scrape detailed sections
      await this.scrapeDetailedSections(medicine, sectionLinks);

      // Add delay between requests
      if (this.options.delay && this.options.delay > 0) {
        await this.delay(this.options.delay);
      }

      return medicine;

    } catch (error) {
      console.log(`Failed to scrape medicine: ${link.name} - ${error}`);
      return null;
    }
  }

  private async getSectionLinks(medicineUrl: string): Promise<any> {
    if (!this.browser) throw new Error('Browser not initialized');

    try {
      const page = await this.browser.newPage();
      await page.goto(medicineUrl, { waitUntil: 'networkidle', timeout: 15000 });

      const sectionLinks = await page.evaluate(() => {
        const links: any = {};
        const linkElements = document.querySelectorAll('a[href*="/medicines/"]');
        
        linkElements.forEach(link => {
          const href = link.getAttribute('href');
          const text = link.textContent?.toLowerCase().trim();
          
          if (href && text) {
            const fullUrl = href.startsWith('http') ? href : `https://www.nhs.uk${href}`;
            
            if (text.includes('about')) {
              links.about = fullUrl;
            } else if (text.includes('who can') || text.includes('cannot take')) {
              links.whoCanTake = fullUrl;
            } else if (text.includes('how and when') || text.includes('how to take')) {
              links.howAndWhenToTake = fullUrl;
            } else if (text.includes('side effect')) {
              links.sideEffects = fullUrl;
            } else if (text.includes('pregnancy') || text.includes('breastfeeding') || text.includes('fertility')) {
              links.pregnancy = fullUrl;
            } else if (text.includes('taking with') || text.includes('other medicines') || text.includes('interaction')) {
              links.interactions = fullUrl;
            } else if (text.includes('common question')) {
              links.commonQuestions = fullUrl;
            }
          }
        });
        
        return links;
      });

      await page.close();
      return sectionLinks;

    } catch (error) {
      console.log(`Failed to get section links: ${medicineUrl}`);
      return {};
    }
  }

  /**
   * Scrapes detailed sections for a medicine
   * Able to scrape: Eligibility, How/When to Take, Side Effects, Pregnancy, Interactions sections
   * Uses unified extractSectionContent method for consistent extraction
   */
  private async scrapeDetailedSections(medicineInfo: any, sectionLinks: any): Promise<void> {
    if (!this.browser) throw new Error('Browser not initialized');

    // Scrape each section using the unified extraction approach
    if (sectionLinks.about) {
      const aboutSection = await this.extractSectionContent(sectionLinks.about);
      aboutSection.sections = aboutSection.sections.map(section => ({
        ...section,
        paragraphText: this.enhanceGrammar(section.paragraphText)
      }));
      medicineInfo.about = aboutSection;
    }
    if (sectionLinks.whoCanTake) {
      const eligibilitySection = await this.extractSectionContent(sectionLinks.whoCanTake);
      eligibilitySection.sections = eligibilitySection.sections.map(section => ({
        ...section,
        paragraphText: this.enhanceGrammar(section.paragraphText)
      }));
      medicineInfo.eligibility = eligibilitySection;
    }
    if (sectionLinks.howAndWhenToTake) {
      const howToTakeSection = await this.extractSectionContent(sectionLinks.howAndWhenToTake);
      howToTakeSection.sections = howToTakeSection.sections.map(section => ({
        ...section,
        paragraphText: this.enhanceGrammar(section.paragraphText)
      }));
      medicineInfo.howAndWhenToTake = howToTakeSection;
    }
    if (sectionLinks.sideEffects) {
      const sideEffectsSection = await this.extractSectionContent(sectionLinks.sideEffects);
      sideEffectsSection.sections = sideEffectsSection.sections.map(section => ({
        ...section,
        paragraphText: this.enhanceGrammar(section.paragraphText)
      }));
      medicineInfo.sideEffects = sideEffectsSection;
    }
    if (sectionLinks.pregnancy) {
      const pregnancySection = await this.extractSectionContent(sectionLinks.pregnancy);
      pregnancySection.sections = pregnancySection.sections.map(section => ({
        ...section,
        paragraphText: this.enhanceGrammar(section.paragraphText)
      }));
      medicineInfo.pregnancyBreastFeedingFertility = pregnancySection;
    }
    if (sectionLinks.interactions) {
      const interactionsSection = await this.extractSectionContent(sectionLinks.interactions);
      interactionsSection.sections = interactionsSection.sections.map(section => ({
        ...section,
        paragraphText: this.enhanceGrammar(section.paragraphText)
      }));
      medicineInfo.takingWithOther = interactionsSection;
    }
    if (sectionLinks.commonQuestions) {
      const commonQuestionsSection = await this.extractCommonQuestions(sectionLinks.commonQuestions);
      commonQuestionsSection.sections = commonQuestionsSection.sections.map(section => ({
        ...section,
        paragraphText: this.enhanceGrammar(section.paragraphText)
      }));
      medicineInfo.commonQuestions = commonQuestionsSection;
    }
  }

  /**
   * Extracts content from detailed sections (About, Eligibility, How/When to Take, Side Effects, Pregnancy, Interactions)
   * Uses unified approach to find section elements and extract headings + content
   * Handles sections with and without headings
   */
  private async extractSectionContent(url: string): Promise<MedicineSection> {
    if (!this.browser) throw new Error('Browser not initialized');

    try {
      const page = await this.browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      
      // Dismiss cookie banner
      await this.dismissCookieBanner(page);
      
      const sections = await page.evaluate(() => {
        const cleanText = (text: string | null | undefined): string | undefined => {
          if (!text) return undefined;
          return text
            .replace(/\u00A0/g, ' ') // Replace non-breaking spaces with regular spaces
            .replace(/–/g, ' ') // Replace en dash with space
            .replace(/—/g, ' ') // Replace em dash with space
            .replace(/([.!?:])([A-Z])/g, '$1 $2') // Add space after periods/bangs/questions/colons before capital letters
            .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between lowercase and uppercase letters
            .replace(/([a-z])(\d)/g, '$1 $2') // Add space between letters and numbers
            .replace(/(\d)([A-Z])/g, '$1 $2') // Add space between numbers and capital letters
            .replace(/([a-z])([a-z][a-z][a-z]+)/g, (match, p1, p2) => {
              // Fix concatenated words like "cold soresgenital herpeseye infections"
              // Look for patterns where lowercase letters are followed by longer lowercase words
              if (p2.length >= 4 && p2.charAt(0) === p2.charAt(0).toLowerCase()) {
                // Check if this looks like separate words (common medical terms)
                const commonWords = ['cold', 'genital', 'eye', 'skin', 'oral', 'nasal', 'ear', 'hand', 'foot', 'back', 'chest', 'head', 'neck', 'arm', 'leg'];
                for (const word of commonWords) {
                  if (p2.toLowerCase().startsWith(word)) {
                    return p1 + ' ' + p2;
                  }
                }
              }
              return match;
            })
            .replace(/cold soresgenital herpeseye infections/g, 'cold sores genital herpes eye infections')
            .replace(/cold soresgenital herpes/g, 'cold sores genital herpes')
            .replace(/genital herpeseye infections/g, 'genital herpes eye infections')
            .replace(/medicinehave/g, 'medicine have')
            .replace(/y ears/g, 'years')
            .replace(/oldare/g, 'old are')
            .replace(/problemsare/g, 'problems are')
            .replace(/breastfeeding\./g, 'breastfeeding.')
      .replace(/:([a-z])/g, ': $1') // Add space after colon before lowercase letters
            .replace(/:([a-z])/g, ': $1') // Add space after colon before lowercase letters
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();
        };

        const paragraphs: Section[] = [];

        // Note: We intentionally don't capture content before first heading to avoid duplicates
        // The main descriptive text is typically captured in the summary field

        // Find all headings and extract content under each (more precise approach)
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        
        headings.forEach(heading => {
          const title = cleanText(heading.textContent);
          if (title && title.length > 3 && 
              !title.includes('Page last reviewed') &&
              !title.includes('Next review due') &&
              !title.includes('Health A to Z') &&
              !title.includes('NHS services') &&
              !title.includes('Support links') &&
              !title.includes('Cookies') &&
              !title.includes('More in ') &&
              !title.includes('Help us improve') &&
              !title.includes('Can you answer') &&
              !title.includes('Take our survey')) {
            
            // Extract content under this heading until the next heading
            let content = '';
            let nextElement = heading.nextElementSibling;
            
            while (nextElement && !nextElement.matches('h1, h2, h3, h4, h5, h6')) {
              const text = cleanText(nextElement.textContent);
              if (text && text.length > 10) {
                content += text + ' ';
              }
              nextElement = nextElement.nextElementSibling;
            }
            
            if (content.trim().length > 20) {
              paragraphs.push({
                paragraphTitle: title,
                paragraphText: content.trim()
              });
            }
          }
        });

        return paragraphs;
      });

      await page.close();
      return { sections, url };
      
    } catch (error) {
      console.log(`Failed to extract content from: ${url}`);
      return { sections: [], url };
    }
  }

  /**
   * Extracts Common Questions section content
   * Specialized method for Q&A format using <details> elements
   * Extracts questions from summary-text and answers from details-text
   */
  private async extractCommonQuestions(url: string): Promise<MedicineSection> {
    if (!this.browser) throw new Error('Browser not initialized');

    try {
      const page = await this.browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

      // Dismiss cookie banner
      await this.dismissCookieBanner(page);

      const sections = await page.evaluate(() => {
        const cleanText = (text: string | null | undefined): string | undefined => {
          if (!text) return undefined;
          return text
            .replace(/\u00A0/g, ' ') // Replace non-breaking spaces with regular spaces
            .replace(/–/g, ' ') // Replace en dash with space
            .replace(/—/g, ' ') // Replace em dash with space
            .replace(/([.!?:])([A-Z])/g, '$1 $2') // Add space after periods/bangs/questions/colons before capital letters
            .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between lowercase and uppercase letters
            .replace(/([a-z])(\d)/g, '$1 $2') // Add space between letters and numbers
            .replace(/(\d)([A-Z])/g, '$1 $2') // Add space between numbers and capital letters
            .replace(/([a-z])([a-z][a-z][a-z]+)/g, (match, p1, p2) => {
              // Fix concatenated words like "cold soresgenital herpeseye infections"
              // Look for patterns where lowercase letters are followed by longer lowercase words
              if (p2.length >= 4 && p2.charAt(0) === p2.charAt(0).toLowerCase()) {
                // Check if this looks like separate words (common medical terms)
                const commonWords = ['cold', 'genital', 'eye', 'skin', 'oral', 'nasal', 'ear', 'hand', 'foot', 'back', 'chest', 'head', 'neck', 'arm', 'leg'];
                for (const word of commonWords) {
                  if (p2.toLowerCase().startsWith(word)) {
                    return p1 + ' ' + p2;
                  }
                }
              }
              return match;
            })
            .replace(/cold soresgenital herpeseye infections/g, 'cold sores genital herpes eye infections')
            .replace(/cold soresgenital herpes/g, 'cold sores genital herpes')
            .replace(/genital herpeseye infections/g, 'genital herpes eye infections')
            .replace(/medicinehave/g, 'medicine have')
            .replace(/y ears/g, 'years')
            .replace(/oldare/g, 'old are')
            .replace(/problemsare/g, 'problems are')
            .replace(/breastfeeding\./g, 'breastfeeding.')
      .replace(/:([a-z])/g, ': $1') // Add space after colon before lowercase letters
            .replace(/:([a-z])/g, ': $1') // Add space after colon before lowercase letters
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();
        };

        const paragraphs: Section[] = [];

        // Find all details elements (common questions)
        const detailsElements = document.querySelectorAll('details.nhsuk-details');
        
        detailsElements.forEach((details) => {
          const summaryText = details.querySelector('.nhsuk-details__summary-text');
          const answerDiv = details.querySelector('.nhsuk-details__text');
          
          if (summaryText && answerDiv) {
            const question = cleanText(summaryText.textContent);
            const answer = cleanText(answerDiv.textContent);
            
            if (question && answer && question.length > 5 && answer.length > 10) {
              paragraphs.push({
                paragraphTitle: question,
                paragraphText: answer
              });
            }
          }
        });

        return paragraphs;
      });

      await page.close();
      return { sections, url };

    } catch (error) {
      console.log(`Failed to extract common questions from: ${url}`);
      return { sections: [], url };
    }
  }

  private async saveResults(result: ScrapingResult): Promise<void> {
    const outputPath = path.join(process.cwd(), 'nhs-medicines.json');
    await fs.writeJson(outputPath, result, { spaces: 2 });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Formats milliseconds into a human-readable time string
   */
  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Creates a visual progress bar
   */
  private createProgressBar(percentage: number, width: number = 20): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  /**
   * Loads word list from external file for smart text cleaning
   */
  private async loadWordList(): Promise<void> {
    try {
      const wordListPath = path.join(__dirname, 'word-list.txt');
      const content = await fs.readFile(wordListPath, 'utf-8');
      
      // Parse words from file (ignore comments and empty lines)
      const words = content
        .split(/\s+/)
        .map(word => word.trim().toLowerCase())
        .filter(word => word && !word.startsWith('#') && word.length > 2);
      
      this.wordList = new Set(words);
      console.log(`📚 Loaded ${this.wordList.size} words for smart text cleaning`);
    } catch (error) {
      console.log('⚠️  Could not load word list, using fallback');
      // Fallback to basic word list
      this.wordList = new Set([
        'about', 'above', 'after', 'again', 'along', 'among', 'around', 'before', 'below', 'between', 'during', 'except', 'inside', 'outside', 'through', 'under', 'within', 'without',
        'could', 'would', 'should', 'might', 'shall', 'ought', 'cannot', 'don\'t', 'won\'t', 'can\'t', 'isn\'t', 'aren\'t', 'wasn\'t', 'weren\'t', 'hasn\'t', 'haven\'t', 'hadn\'t', 'doesn\'t', 'didn\'t',
        'years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'times', 'places', 'things', 'people', 'children', 'women', 'men', 'adults', 'patients', 'doctors', 'nurses',
        'medicine', 'medicines', 'tablets', 'tablet', 'liquid', 'cream', 'ointment', 'injection', 'injections', 'drops', 'spray', 'sprays', 'capsules', 'capsule',
        'problems', 'problem', 'issues', 'issue', 'conditions', 'condition', 'diseases', 'disease', 'symptoms', 'symptom', 'effects', 'effect', 'reactions', 'reaction',
        'pregnant', 'pregnancy', 'breastfeeding', 'breastfeed', 'fertility', 'fertile', 'conception', 'contraception', 'contraceptive', 'contraceptives',
        'allergic', 'allergy', 'allergies', 'sensitive', 'sensitivity', 'intolerance', 'intolerant', 'reaction', 'reactions',
        'kidney', 'liver', 'heart', 'lung', 'lungs', 'brain', 'blood', 'skin', 'bone', 'bones', 'muscle', 'muscles', 'joint', 'joints', 'transplant', 'transplants'
      ]);
    }
  }

  /**
   * Smart text cleaning using external word list for pattern recognition
   */
  private smartCleanText(text: string): string {
    if (!text) return text;
    
    return text
      // Basic character normalization
      .replace(/\u00A0/g, ' ') // Replace non-breaking spaces
      .replace(/[–—]/g, ' ') // Replace en/em dashes with spaces
      
      // Punctuation spacing
      .replace(/([.!?:])([A-Z])/g, '$1 $2') // Space after punctuation before capitals
      .replace(/([a-z])([A-Z])/g, '$1 $2') // Space between lowercase and uppercase
      .replace(/([a-z])(\d)/g, '$1 $2') // Space between letters and numbers
      .replace(/(\d)([A-Z])/g, '$1 $2') // Space between numbers and capitals
      .replace(/:([a-z])/g, ': $1') // Space after colon before lowercase
      
      // Smart word separation using external word list
      .replace(/([a-z])([a-z]{3,})/g, (match, p1, p2) => {
        // Check if the second part starts with a word from our dictionary
        if (this.wordList.has(p2.toLowerCase())) {
          return p1 + ' ' + p2;
        }
        return match;
      })
      
      // Final cleanup
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private async dismissCookieBanner(page: any): Promise<void> {
    try {
      const cookieSelectors = [
        'button:has-text("Accept")',
        'button:has-text("Accept all")', 
        'button:has-text("I accept")',
        'button:has-text("Accept all cookies")',
        '[data-testid="accept-cookies"]',
        '.nhsuk-cookie-banner button',
        '#nhsuk-cookie-banner button'
      ];
      
      for (const selector of cookieSelectors) {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          await page.waitForTimeout(2000);
          break;
        }
      }
    } catch (error) {
      // Cookie banner might not be present
    }
  }

  private cleanText(text: string | null | undefined): string | undefined {
    if (!text) return undefined;
    return text
      .replace(/\u00A0/g, ' ') // Replace non-breaking spaces with regular spaces
      .replace(/([.!?:])([A-Z])/g, '$1 $2') // Add space after periods/bangs/questions/colons before capital letters
      .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between lowercase and uppercase letters
      .replace(/([a-z])(\d)/g, '$1 $2') // Add space between letters and numbers
      .replace(/(\d)([A-Z])/g, '$1 $2') // Add space between numbers and capital letters
      .replace(/([a-z])([a-z][a-z][a-z]+)/g, (match, p1, p2) => {
        // Fix concatenated words like "cold soresgenital herpeseye infections"
        // Look for patterns where lowercase letters are followed by longer lowercase words
        if (p2.length >= 4 && p2.charAt(0) === p2.charAt(0).toLowerCase()) {
          // Check if this looks like separate words (common medical terms)
          const commonWords = ['cold', 'genital', 'eye', 'skin', 'oral', 'nasal', 'ear', 'hand', 'foot', 'back', 'chest', 'head', 'neck', 'arm', 'leg'];
          for (const word of commonWords) {
            if (p2.toLowerCase().startsWith(word)) {
              return p1 + ' ' + p2;
            }
          }
        }
        return match;
      })
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
  }

  /**
   * Post-processes text to improve grammar and readability
   * Uses smart text cleaning + grammar enhancement
   */
  private enhanceGrammar(text: string): string {
    if (!text) return text;
    
    // First apply smart text cleaning
    let cleanedText = this.smartCleanText(text);
    
    // Then apply grammar enhancements
    return cleanedText
      // Add periods at the end of sentences that don't have them (but not in lists)
      .replace(/([a-z])\s+([A-Z][a-z])/g, (match, p1, p2) => {
        // Don't add period if it's already there or if it's a list item
        if (match.includes('.') || match.includes(':')) return match;
        return p1 + '. ' + p2;
      })
      
      // Add commas in compound sentences with conjunctions
      .replace(/([a-z])\s+(but|however|therefore|moreover|furthermore)\s+([a-z])/g, '$1, $2 $3')
      
      // Fix "it's" and contractions
      .replace(/\bits\s+([a-z])/g, "it's $1")
      .replace(/\byou\s+([a-z])/g, (match, p1) => {
        if (['are', 'have', 'can', 'should', 'will', 'may'].includes(p1)) {
          return match.replace('you ' + p1, "you're " + p1);
        }
        return match;
      })
      
      // Final cleanup
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// Semaphore class for controlling concurrency
class Semaphore {
  private permits: number;
  private waitQueue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) {
        this.permits--;
        next();
      }
    }
  }
}
