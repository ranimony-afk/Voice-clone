/**
 * VoiceForge Synthesis Job Worker (Phase 3B)
 * 
 * Provides:
 * - Asynchronous state machine (pending -> processing -> completed / cancelled / failed)
 * - Strict race condition defense for in-flight biometric consent revocation
 * - Worker tenant isolation validation
 * - Artifact generation and private storage binding
 */

import { VoiceProfile } from '../types.ts';
import { VoiceForgeSynthesizer } from './synthesizer.ts';
import { ConsentVerificationEngine } from './consent.ts';
import { PrivateStorageService } from '../../storage/privateStorage.ts';

export interface SynthesisJobRecord {
  id: string;
  userId: string;
  voiceId: string;
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'failed';
  executionMode: 'NEURAL' | 'DEMO' | 'UNAVAILABLE';
  inputText: string;
  language: string;
  outputMediaId?: string;
  outputSignedUrl?: string;
  durationSeconds?: number;
  characterCount?: number;
  creditsCharged: number;
  watermarkSignature?: string;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export class SynthesisJobWorker {
  private synthesizer = new VoiceForgeSynthesizer();

  /**
   * Executes a queued synthesis job with multi-gate consent validation
   */
  public async executeJob(
    job: SynthesisJobRecord,
    voice: VoiceProfile,
    workerTenantId: string,
    onProgressHook?: (stage: string) => void
  ): Promise<SynthesisJobRecord> {
    // GATE 1: Worker tenant validation
    if (workerTenantId !== 'worker_system' && workerTenantId !== job.userId) {
      job.status = 'failed';
      job.errorMessage = 'Security violation: Worker tenant mismatch during job execution.';
      return job;
    }

    // GATE 2: Pre-execution consent check (handles revocation between submission & worker pickup)
    if (job.voiceId && !ConsentVerificationEngine.isConsentActive(job.voiceId)) {
      job.status = 'cancelled';
      job.errorMessage = 'Biometric consent for voice profile was revoked prior to execution.';
      return job;
    }

    job.status = 'processing';
    if (onProgressHook) onProgressHook('processing_started');

    // GATE 3: Mid-synthesis execution with cancellation check
    try {
      const result = await this.synthesizer.synthesize(
        { text: job.inputText, voiceId: job.voiceId, language: job.language as any },
        voice
      );

      // GATE 4: In-flight check right before persisting artifact (handles revocation while synthesizer ran)
      if (job.voiceId && !ConsentVerificationEngine.isConsentActive(job.voiceId)) {
        job.status = 'cancelled';
        job.errorMessage = 'Biometric consent for voice profile was revoked during synthesis execution.';
        return job;
      }

      // GATE 5: Secure media storage with voiceId linkage
      const audioBuffer = Buffer.from(result.audioBase64, 'base64');
      const mediaRecord = await PrivateStorageService.storeMedia({
        userId: job.userId,
        voiceId: job.voiceId,
        mediaType: 'tts_output',
        filename: `tts_${job.id}.wav`,
        buffer: audioBuffer,
      });

      job.status = 'completed';
      job.outputMediaId = mediaRecord.id;
      job.outputSignedUrl = PrivateStorageService.generateSignedDownloadUrl(mediaRecord.id, job.userId);
      job.durationSeconds = result.durationSeconds;
      job.executionMode = (result.executionMode || 'DEMO') as 'NEURAL' | 'DEMO' | 'UNAVAILABLE';
      job.watermarkSignature = result.watermarkSignature;
      job.completedAt = new Date().toISOString();

      if (onProgressHook) onProgressHook('completed');
      return job;
    } catch (err: any) {
      job.status = 'failed';
      job.errorMessage = err.message;
      return job;
    }
  }
}
