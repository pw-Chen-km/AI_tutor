import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LLMApiKeys {
    openai: string;
    gemini: string;
    anthropic: string;
    deepseek: string;
    custom: string;
}

/** Per-provider model names, used when building the LLM pool for parallel processing. */
export type LLMProviderModels = Partial<Record<keyof LLMApiKeys, string>>;

export interface LLMConfig {
    provider: 'openai' | 'gemini' | 'deepseek' | 'anthropic' | 'custom';
    apiKey: string; // Deprecated: kept for backward compatibility, use apiKeys instead
    apiKeys: LLMApiKeys;
    baseURL: string;
    model: string;
    /** Model name per provider (for parallel processing). Keys: openai, gemini, anthropic, deepseek, custom. */
    providerModels?: LLMProviderModels;
}

export interface LanguageConfig {
    primaryLanguage: string;   // used for question/answer main language
    secondaryLanguage: string; // used for bilingual comparison; use "none" to disable
}

export interface ContextFile {
    id: string;
    name: string;
    type: string;
    content: string;
    // Optional raw file payload for formats where we want to preserve structure (e.g. PPTX for slide-by-slide notes).
    // Not persisted (see partialize below).
    rawBase64?: string;
    uploadedAt: Date;
}

// Custom question type selections for "Customized" subject
export interface CustomQuestionTypes {
    drills: string[];  // Array of QuestionTypeId
    labs: string[];
    homework: string[];
    exams: string[];
}

export interface AppState {
    // LLM Configuration
    llmConfig: LLMConfig;
    setLLMConfig: (config: Partial<LLMConfig>) => void;

    // Global Language Configuration (for generated question/answer text)
    languageConfig: LanguageConfig;
    setLanguageConfig: (config: Partial<LanguageConfig>) => void;

    // Global Subject (for question types and prompting)
    subject: string;
    setSubject: (subject: string) => void;

    // Custom Question Types (for "Customized" subject)
    customQuestionTypes: CustomQuestionTypes;
    setCustomQuestionTypes: (moduleType: keyof CustomQuestionTypes, types: string[]) => void;
    toggleCustomQuestionType: (moduleType: keyof CustomQuestionTypes, typeId: string) => void;

    // Context Management
    contextFiles: ContextFile[];
    addContextFile: (file: ContextFile) => void;
    removeContextFile: (id: string) => void;
    clearContextFiles: () => void;
    
    // Exam Evaluation: Separate teacher and student files
    teacherFiles: ContextFile[]; // Teacher's questions and correct answers
    studentFiles: ContextFile[]; // Student submissions
    addTeacherFile: (file: ContextFile) => void;
    removeTeacherFile: (id: string) => void;
    clearTeacherFiles: () => void;
    addStudentFile: (file: ContextFile) => void;
    removeStudentFile: (id: string) => void;
    clearStudentFiles: () => void;

    // Generated Content
    generatedContent: {
        drills: any[];
        labs: any[];
        homework: any[];
        exams: any[];
        lecture_rehearsal: any[];
        exam_evaluation: any[];
    };
    setGeneratedContent: (type: keyof AppState['generatedContent'], content: any[]) => void;
    
    // Exam Export Settings (persistent across modules)
    examExportSettings: {
        institutionLogoBase64: string | null;
        institutionLogoName: string | null;
    };
    setInstitutionLogo: (base64: string | null, name: string | null) => void;
    
    // Variant Management (for Similar Generate feature)
    // Each item can have variants stored in a separate map: { [itemId]: variant[] }
    variants: {
        drills: Record<string, any[]>;
        labs: Record<string, any[]>;
        homework: Record<string, any[]>;
        exams: Record<string, any[]>;
    };
    addVariant: (moduleType: 'drills' | 'labs' | 'homework' | 'exams', itemId: string, variant: any) => void;
    removeVariant: (moduleType: 'drills' | 'labs' | 'homework' | 'exams', itemId: string, variantId: string) => void;
    reorderVariants: (moduleType: 'drills' | 'labs' | 'homework' | 'exams', itemId: string, variantIds: string[]) => void;
    clearVariants: (moduleType: 'drills' | 'labs' | 'homework' | 'exams') => void;

    // UI State
    activeModule: 'drills' | 'labs' | 'homework' | 'exams' | 'lecture_rehearsal' | 'exam_evaluation';
    setActiveModule: (module: AppState['activeModule']) => void;

    // Web Search Toggle
    includeWebResources: boolean;
    setIncludeWebResources: (include: boolean) => void;

    // Export Templates (optional)
    exportTemplates: Array<{
        id: string; // stored in IndexedDB
        name: string;
        type: 'docx' | 'pptx';
    }>;
    setExportTemplates: (templates: AppState['exportTemplates']) => void;
    clearExportTemplates: () => void;
}

export const useStore = create<AppState>()(
    persist(
        (set) => ({
            // LLM Configuration Initial State
            llmConfig: {
                provider: 'openai',
                apiKey: '', // Deprecated
                apiKeys: {
                    openai: '',
                    gemini: '',
                    anthropic: '',
                    deepseek: '',
                    custom: '',
                },
                baseURL: 'https://api.openai.com/v1',
                model: 'gpt-4o',
                providerModels: {}, // per-provider model names for parallel processing
            },
            setLLMConfig: (config) =>
                set((state) => ({
                    llmConfig: { ...state.llmConfig, ...config },
                })),

            // Global Language Configuration Initial State
            languageConfig: {
                primaryLanguage: 'English',
                secondaryLanguage: '繁體中文',
            },
            setLanguageConfig: (config) =>
                set((state) => ({
                    languageConfig: { ...state.languageConfig, ...config },
                })),

            // Global Subject Initial State
            subject: 'computer_science',
            setSubject: (subject) => set({ subject }),

            // Custom Question Types (for "Customized" subject)
            // Default: all types enabled for all modules
            customQuestionTypes: {
                drills: ['multiple_choice', 'fill_in_blank', 'short_answer', 'coding', 'debugging', 'trace'],
                labs: ['coding', 'debugging', 'design', 'data_analysis', 'case_study', 'short_answer'],
                homework: ['multiple_choice', 'short_answer', 'calculation', 'coding', 'case_study'],
                exams: ['multiple_choice', 'fill_in_blank', 'short_answer', 'coding', 'calculation'],
            },
            setCustomQuestionTypes: (moduleType, types) =>
                set((state) => ({
                    customQuestionTypes: {
                        ...state.customQuestionTypes,
                        [moduleType]: types,
                    },
                })),
            toggleCustomQuestionType: (moduleType, typeId) =>
                set((state) => {
                    const current = state.customQuestionTypes[moduleType];
                    const newTypes = current.includes(typeId)
                        ? current.filter((t) => t !== typeId)
                        : [...current, typeId];
                    return {
                        customQuestionTypes: {
                            ...state.customQuestionTypes,
                            [moduleType]: newTypes,
                        },
                    };
                }),

            // Context Management
            contextFiles: [],
            addContextFile: (file) =>
                set((state) => ({
                    contextFiles: [...state.contextFiles, file],
                })),
            removeContextFile: (id) =>
                set((state) => ({
                    contextFiles: state.contextFiles.filter((f) => f.id !== id),
                })),
            clearContextFiles: () => set({ contextFiles: [] }),
            
            // Exam Evaluation: Separate teacher and student files
            teacherFiles: [],
            studentFiles: [],
            addTeacherFile: (file) =>
                set((state) => ({
                    teacherFiles: [...state.teacherFiles, file],
                })),
            removeTeacherFile: (id) =>
                set((state) => ({
                    teacherFiles: state.teacherFiles.filter((f) => f.id !== id),
                })),
            clearTeacherFiles: () => set({ teacherFiles: [] }),
            addStudentFile: (file) =>
                set((state) => ({
                    studentFiles: [...state.studentFiles, file],
                })),
            removeStudentFile: (id) =>
                set((state) => ({
                    studentFiles: state.studentFiles.filter((f) => f.id !== id),
                })),
            clearStudentFiles: () => set({ studentFiles: [] }),

            // Generated Content
            generatedContent: {
                drills: [],
                labs: [],
                homework: [],
                exams: [],
                lecture_rehearsal: [],
                exam_evaluation: [],
            },
            setGeneratedContent: (type, content) =>
                set((state) => ({
                    generatedContent: {
                        ...state.generatedContent,
                        [type]: content,
                    },
                })),

            // Exam Export Settings
            examExportSettings: {
                institutionLogoBase64: null,
                institutionLogoName: null,
            },
            setInstitutionLogo: (base64, name) =>
                set({
                    examExportSettings: {
                        institutionLogoBase64: base64,
                        institutionLogoName: name,
                    },
                }),

            // Variant Management
            variants: {
                drills: {},
                labs: {},
                homework: {},
                exams: {},
            },
            addVariant: (moduleType, itemId, variant) =>
                set((state) => {
                    const currentVariants = state.variants[moduleType][itemId] || [];
                    return {
                        variants: {
                            ...state.variants,
                            [moduleType]: {
                                ...state.variants[moduleType],
                                [itemId]: [...currentVariants, variant],
                            },
                        },
                    };
                }),
            removeVariant: (moduleType, itemId, variantId) =>
                set((state) => {
                    const currentVariants = state.variants[moduleType][itemId] || [];
                    return {
                        variants: {
                            ...state.variants,
                            [moduleType]: {
                                ...state.variants[moduleType],
                                [itemId]: currentVariants.filter((v: any) => v.variantId !== variantId),
                            },
                        },
                    };
                }),
            reorderVariants: (moduleType, itemId, variantIds) =>
                set((state) => {
                    const currentVariants = state.variants[moduleType][itemId] || [];
                    const reordered = variantIds
                        .map((id) => currentVariants.find((v: any) => v.variantId === id))
                        .filter(Boolean);
                    return {
                        variants: {
                            ...state.variants,
                            [moduleType]: {
                                ...state.variants[moduleType],
                                [itemId]: reordered,
                            },
                        },
                    };
                }),
            clearVariants: (moduleType) =>
                set((state) => ({
                    variants: {
                        ...state.variants,
                        [moduleType]: {},
                    },
                })),

            // UI State
            activeModule: 'drills',
            setActiveModule: (module) => set({ activeModule: module }),

            // Web Search
            includeWebResources: false,
            setIncludeWebResources: (include) => set({ includeWebResources: include }),

            // Export Templates
            exportTemplates: [],
            setExportTemplates: (templates) => set({ exportTemplates: templates }),
            clearExportTemplates: () => set({ exportTemplates: [] }),
        }),
        {
            name: 'ai-teaching-assistant-storage',
            version: 4,
            migrate: (persistedState: any, version: number) => {
                // Migrate from version 1 to 2: convert exportTemplates from object to array
                if (version < 2) {
                    if (persistedState?.exportTemplates) {
                        // If it's not an array, reset it to empty array
                        if (!Array.isArray(persistedState.exportTemplates)) {
                            persistedState.exportTemplates = [];
                        }
                        // Also clean up any old base64 fields that might have been stored
                        delete persistedState.exportTemplates?.docxTemplateBase64;
                        delete persistedState.exportTemplates?.pptxTemplateBase64;
                        delete persistedState.exportTemplates?.docxTemplateName;
                        delete persistedState.exportTemplates?.pptxTemplateName;
                    } else {
                        persistedState.exportTemplates = [];
                    }
                }
                // Ensure it's always an array (defensive check)
                if (!Array.isArray(persistedState?.exportTemplates)) {
                    persistedState.exportTemplates = [];
                }
                
                // Migrate from version 2 to 3: convert single apiKey to apiKeys object
                if (version < 3) {
                    if (persistedState?.llmConfig) {
                        const oldApiKey = persistedState.llmConfig.apiKey || '';
                        const currentProvider = persistedState.llmConfig.provider || 'openai';
                        
                        // Initialize apiKeys if not exists
                        if (!persistedState.llmConfig.apiKeys) {
                            persistedState.llmConfig.apiKeys = {
                                openai: '',
                                gemini: '',
                                anthropic: '',
                                deepseek: '',
                                custom: '',
                            };
                            // Migrate the old apiKey to the current provider
                            if (oldApiKey) {
                                persistedState.llmConfig.apiKeys[currentProvider] = oldApiKey;
                            }
                        }
                    }
                }
                // Migrate from version 3 to 4: add providerModels for per-provider model names
                if (version < 4) {
                    if (persistedState?.llmConfig && persistedState.llmConfig.providerModels == null) {
                        persistedState.llmConfig.providerModels = {};
                    }
                }
                
                return persistedState;
            },
            partialize: (state) => ({
                llmConfig: state.llmConfig,
                languageConfig: state.languageConfig,
                subject: state.subject,
                customQuestionTypes: state.customQuestionTypes,
                activeModule: state.activeModule,
                exportTemplates: state.exportTemplates,
            }),
        }
    )
);
