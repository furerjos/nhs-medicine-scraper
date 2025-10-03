# NHS Medicine Scraper

A TypeScript/Playwright script that scrapes all medicines and their detailed information from the NHS website and bundles them into a comprehensive JSON file.

## 🎯 Assignment Overview

This project extracts all 291 medicines from the NHS A-Z medicines page, capturing detailed information including dosage instructions, side effects, eligibility criteria, and more. The scraper successfully completed with a **100% success rate** (291/291 medicines scraped).

*Note: This project was developed as a technical assignment while on vacation, demonstrating efficient time management and focused development practices.*

## ⏱️ Development Timeline

**Total Time: ~3 hours** (within the 2-4 hour assignment timeframe)

- **Initial 15 minutes**: Created scraper that successfully scraped NHS medicine webpage for all medicines, their URLs, and their section links
- **Additional 45 minutes**: Developed scraper to extract specific values from each section
- **Additional 1 hour**: Refactored to paragraphTitle/paragraphText paradigm for better robustness
- **Final hour**: Finishing touches including text cleaning, grammar enhancement, logging, and documentation

**Tools Used**: TypeScript, Playwright, and Cursor AI for development assistance

## 🏗️ Architecture & Design Decisions

### Paradigm Shift: Flexible Section Structure
Initially, I attempted to create rigid, medicine-specific field names (e.g., `dosage`, `contraindications`). However, this approach proved fragile because:
- **Content varies significantly** between medicines
- **Section structures differ** across different medicine pages  
- **New content types** would require code changes

**Solution**: Adopted a flexible `paragraphTitle` + `paragraphText` paradigm that:
- ✅ **Captures all content** regardless of structure
- ✅ **Scales automatically** to new content types
- ✅ **Maintains consistency** across all medicines
- ✅ **Enables easy parsing** of structured data later

This design choice makes the scraper robust and future-proof.

## ✨ Key Features

- 🏥 **Complete Coverage**: Scrapes all 291 medicines from NHS A-Z medicines page
- 📋 **Comprehensive Data**: Extracts detailed information across 7 major sections:
  - **About**: Medicine description, key facts, and what it treats
  - **Eligibility**: Who can and cannot take the medicine
  - **How and When to Take**: Dosage instructions and administration methods
  - **Side Effects**: Common, serious side effects and warnings
  - **Pregnancy/Breastfeeding/Fertility**: Safety information for special populations
  - **Taking with Other**: Drug interactions, painkillers, and herbal supplements
  - **Common Questions**: FAQ-style questions and answers
- 🚀 **Production Ready**: Configurable concurrency, rate limiting, and error handling
- 🧪 **Developer Friendly**: Test mode, comprehensive logging, and time tracking
- 📊 **High Reliability**: 100% success rate with robust retry logic
- 🧹 **Text Processing**: Smart text cleaning and grammar enhancement
- 📁 **Structured Output**: Clean, consistent JSON format

## Installation

1. Install dependencies:
```bash
npm install
```

2. Install Playwright browsers:
```bash
npx playwright install chromium
```

## Usage

### Full Scraping (All Medicines)
```bash
npm run scrape
```

### Test Mode (Limited Medicines)
```bash
npm run dev -- --test --limit 5
```

### Development Mode
```bash
npm run dev
```

## Command Line Options

- `--test`: Run in test mode (limited medicines)
- `--limit <number>`: Number of medicines to scrape in test mode (default: 10)
- `--output <file>`: Output JSON file path (default: nhs-medicines.json)
- `--concurrency <number>`: Max concurrent requests (default: 3)
- `--delay <ms>`: Delay between requests in ms (default: 1000)
- `--help`: Show help message

## Examples

```bash
# Full scraping of all medicines
npm run scrape

# Test with 5 medicines
npm run dev -- --test --limit 5

# Custom output file
npm run dev -- --output my-medicines.json

# Higher concurrency (be respectful!)
npm run dev -- --concurrency 5

# Slower scraping (more respectful)
npm run dev -- --delay 2000
```

## Output Format

The scraper generates a JSON file with a unified structure where each section contains paragraphs with titles and text:

```json
{
  "totalMedicines": 291,
  "scrapedMedicines": 291,
  "failedMedicines": [],
  "medicines": [
    {
      "name": "Aciclovir (Zovirax)",
      "url": "https://www.nhs.uk/medicines/aciclovir/",
      "dateCaptured": "2025-10-03T00:32:05.405Z",
      "otherBrandNames": "Cymex Ultra, Virasorb",
      "summary": "Find out how aciclovir treats cold sores...",
      "about": {
        "sections": [
          {
            "paragraphTitle": "About aciclovir",
            "paragraphText": "Aciclovir (or acyclovir) is an antiviral medicine..."
          },
          {
            "paragraphTitle": "Key facts", 
            "paragraphText": "Start taking or using aciclovir as soon as..."
          }
        ],
        "url": "https://www.nhs.uk/medicines/aciclovir/about-aciclovir/"
      },
      "eligibility": {
        "sections": [
          {
            "paragraphTitle": "Who can take aciclovir",
            "paragraphText": "Most adults and children can take aciclovir..."
          }
        ],
        "url": "https://www.nhs.uk/medicines/aciclovir/who-can-and-cannot-take-or-use-aciclovir/"
      },
      "relatedConditions": ["Chickenpox", "Cold sores", "Genital herpes", "Shingles"]
    }
  ],
  "scrapedAt": "2024-03-15T10:30:00.000Z"
}
```

## Technical Details

- **Framework**: TypeScript with Playwright
- **Browser**: Chromium (headless)
- **Concurrency**: Configurable (default: 3 concurrent requests)
- **Rate Limiting**: 1 second delay between requests (configurable)
- **Retry Logic**: Up to 3 retries for failed requests
- **Error Handling**: Comprehensive error handling with detailed logging

## Ethical Considerations

This scraper is designed to be respectful to the NHS website:
- Implements rate limiting to avoid overwhelming the server
- Uses reasonable delays between requests
- Includes retry logic for temporary failures
- Designed for educational/technical assignment purposes

## Project Structure

```
├── src/
│   ├── index.ts          # Main entry point with logging setup
│   ├── scraper.ts        # Core scraping logic and text processing
│   ├── types.ts          # TypeScript type definitions
│   ├── test-links.ts     # Standalone script to test medicine link extraction
│   └── word-list.txt     # Dictionary for smart text cleaning
├── logs/                 # Log files (gitignored)
├── nhs-medicines.json    # Complete scraped data (291 medicines)
├── sample-output.json    # Example medicine structure
├── package.json          # Dependencies and scripts
├── package-lock.json     # Dependency lock file
├── tsconfig.json         # TypeScript configuration
├── .gitignore           # Git ignore rules
├── LICENSE              # MIT License
└── README.md            # This file
```

## 🚀 Future Improvements

While the current implementation successfully captures all required data, several enhancements could be made for production use:

### Data Extraction & Processing
- **Structured Value Extraction**: Parse dosage amounts, frequencies, and measurements from `paragraphText` fields
- **Entity Recognition**: Extract drug names, conditions, and medical terms for better searchability
- **Data Validation**: Implement schema validation to ensure data quality and consistency
- **Normalization**: Standardize units (mg, ml, etc.) and time periods (daily, weekly, etc.)

### Text Processing Enhancements
- **Advanced Grammar Correction**: Expand the word dictionary and improve grammar enhancement rules
- **Medical Terminology**: Add specialized medical vocabulary to the text cleaning system
- **Context-Aware Cleaning**: Use NLP to better understand medical context and improve text quality
- **Multilingual Support**: Handle medicines with non-English names or descriptions

### Performance & Scalability
- **Caching**: Implement Redis/database caching to avoid re-scraping unchanged content
- **Incremental Updates**: Only scrape medicines that have been updated since last run
- **Distributed Scraping**: Scale across multiple machines for faster processing
- **API Integration**: Create REST API endpoints for accessing the scraped data

### Monitoring & Reliability
- **Health Checks**: Monitor NHS website changes and alert on structure modifications
- **Data Quality Metrics**: Track completeness and accuracy of extracted information
- **Automated Testing**: Implement comprehensive test suite for regression detection
- **Error Analytics**: Detailed error tracking and automatic retry strategies

### User Experience
- **Web Interface**: Create a user-friendly dashboard for browsing medicines
- **Search Functionality**: Full-text search across all medicine data
- **Export Options**: Support for CSV, XML, and other data formats
- **Real-time Updates**: Live data refresh capabilities

## 📊 Results Summary

- **✅ Total Medicines**: 291
- **✅ Successfully Scraped**: 291 (100% success rate)
- **✅ Failed**: 0
- **⏱️ Total Time**: ~53 minutes
- **📁 Output Size**: ~50,000 lines of structured JSON data
- **🧹 Text Quality**: Smart cleaning and grammar enhancement applied

## License

MIT License - Feel free to use this for educational purposes.
