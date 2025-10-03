export interface Section {
  paragraphTitle: string;
  paragraphText: string;
}

export interface MedicineSection {
  sections: Section[];
  url?: string;
}

export interface MedicineInfo {
  name: string;
  url: string;
  dateCaptured?: string;
  otherBrandNames?: string;
  summary?: string;
  about: MedicineSection;
  eligibility: MedicineSection;
  howAndWhenToTake: MedicineSection;
  sideEffects: MedicineSection;
  pregnancyBreastFeedingFertility: MedicineSection;
  takingWithOther: MedicineSection;
  commonQuestions: MedicineSection;
  relatedConditions?: string[];
}

export interface ScrapingResult {
  totalMedicines: number;
  scrapedMedicines: number;
  failedMedicines: string[];
  medicines: MedicineInfo[];
  scrapedAt: string;
}

export interface ScrapingOptions {
  concurrency?: number;
  delay?: number;
  timeout?: number;
  testMode?: boolean;
  limit?: number;
  maxConcurrency?: number;
  delayBetweenRequests?: number;
  maxRetries?: number;
  outputFile?: string;
  testLimit?: number;
}
