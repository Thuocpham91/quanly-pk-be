import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import { FirebaseService } from './firebase.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly firebaseService: FirebaseService,
  ) {}

  async sendNotificationToUser(userId: string, notification: any): Promise<void> {
    try {
      const entity = this.notificationRepository.create({
        userId,
        type: (notification.type || 'info') as NotificationType,
        message: notification.message,
        data: notification.data || null,
        read: false,
      });
      await this.notificationRepository.save(entity);
      this.logger.log(`Saved notification to user ${userId}: ${notification.message}`);

      // Gửi FCM notification nếu có token
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (user && user.fcmToken) {
        const title = notification.title || 'Thông báo mới';
        const stringifiedData: Record<string, string> = {};
        if (notification.data) {
          Object.entries(notification.data).forEach(([key, val]) => {
            stringifiedData[key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
          });
        }
        stringifiedData['id'] = entity.id;
        stringifiedData['type'] = entity.type;

        await this.firebaseService.sendPushNotification(
          user.fcmToken,
          title,
          notification.message,
          stringifiedData,
        );
      }
    } catch (error) {
      this.logger.error(`Error saving/sending notification to user ${userId}:`, error);
    }
  }

  async broadcastNotification(notification: any): Promise<void> {
    try {
      const entity = this.notificationRepository.create({
        userId: 'all',
        type: (notification.type || 'info') as NotificationType,
        message: notification.message,
        data: notification.data || null,
        read: false,
      });
      await this.notificationRepository.save(entity);
      this.logger.log(`Saved broadcast notification: ${notification.message}`);

      // Tìm tất cả user có fcmToken để bắn FCM
      const users = await this.userRepository.find({
        where: { isActive: true },
        select: ['id', 'fcmToken'],
      });
      
      const title = notification.title || 'Thông báo hệ thống';
      const stringifiedData: Record<string, string> = {};
      if (notification.data) {
        Object.entries(notification.data).forEach(([key, val]) => {
          stringifiedData[key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
        });
      }
      stringifiedData['id'] = entity.id;
      stringifiedData['type'] = entity.type;

      for (const user of users) {
        if (user.fcmToken) {
          await this.firebaseService.sendPushNotification(
            user.fcmToken,
            title,
            notification.message,
            stringifiedData,
          );
        }
      }
    } catch (error) {
      this.logger.error('Error saving/sending broadcast notification:', error);
    }
  }

  async getNotificationsForUser(
    userId: string,
    page: number = 1,
    limit: number = 10,
    q?: string,
  ): Promise<{ data: Notification[]; meta: any }> {
    const skip = (page - 1) * limit;

    const queryBuilder = this.notificationRepository.createQueryBuilder('notification')
      .where('(notification.userId = :userId OR notification.userId = :allUserId)', { userId, allUserId: 'all' });

    if (q) {
      queryBuilder.andWhere('notification.message ILIKE :q', { q: `%${q}%` });
    }

    const [data, total] = await queryBuilder
      .orderBy('notification.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async markAsRead(id: string, _userId: string): Promise<void> {
    await this.notificationRepository.update(
      { id },
      { read: true },
    );
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository
      .createQueryBuilder()
      .update(Notification)
      .set({ read: true })
      .where('userId = :userId AND read = false', { userId })
      .execute();
  }
}
