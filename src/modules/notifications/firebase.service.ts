import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger('FirebaseService');
  private isInitialized = false;

  onModuleInit() {
    try {
      const serviceAccountPath = path.join(process.cwd(), 'firebase-service-account.json');
      if (fs.existsSync(serviceAccountPath)) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccountPath),
        });
        this.isInitialized = true;
        this.logger.log('🔥 Firebase Admin SDK initialized successfully using service account key file.');
      } else {
        this.logger.warn(
          '⚠️ firebase-service-account.json not found in root directory. Real-time push notifications will be disabled.',
        );
      }
    } catch (error) {
      this.logger.error('❌ Failed to initialize Firebase Admin SDK:', error);
    }
  }

  async sendPushNotification(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.isInitialized) {
      this.logger.warn(`Firebase Admin is not initialized. Skipping push to: ${token}`);
      return;
    }

    try {
      await admin.messaging().send({
        token,
        notification: {
          title,
          body,
        },
        data: data || {},
      });
      this.logger.log(`Successfully sent FCM notification to token: ${token.substring(0, 10)}...`);
    } catch (error) {
      this.logger.error(`Error sending FCM notification:`, error);
    }
  }
}
