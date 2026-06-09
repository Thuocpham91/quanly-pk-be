import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { UserBranchRole } from '../branches/entities/user-branch-role.entity';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private reflector: Reflector,
    @InjectRepository(UserBranchRole)
    private userBranchRoleRepo: Repository<UserBranchRole>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const branchId = request.headers['x-branch-id'];

    this.logger.debug(`Checking permissions for user: ${user?.email}, branch: ${branchId}, required: ${requiredPermissions}`);

    if (!user) {
      return false;
    }

    const resolvedUserId = user.userId || user.id || user.sub;

    // Master Admin bypass - case insensitive
    if (user.email?.toLowerCase() === 'admin@gmail.com') {
      this.logger.log(`Master Admin bypass for ${user.email}`);
      return true;
    }

    // Global Admin role bypass: nếu user có role Admin ở bất kỳ chi nhánh nào
    const globalAdminRole = await this.userBranchRoleRepo
      .createQueryBuilder('ubr')
      .innerJoin('ubr.role', 'role')
      .where('ubr.userId = :userId', { userId: resolvedUserId })
      .andWhere('ubr.isActive = true')
      .andWhere('role.name = :roleName', { roleName: 'Admin' })
      .getOne();

    if (globalAdminRole) {
      this.logger.log(`Global Admin role bypass for user ${user.email}`);
      return true;
    }

    let userBranchRole: any;

    if (branchId) {
      // Có branchId → tìm đúng chi nhánh
      userBranchRole = await this.userBranchRoleRepo.findOne({
        where: { userId: resolvedUserId, branchId: branchId as string, isActive: true },
        relations: ['role', 'role.permissions'],
      });
    } else {
      // Không có branchId (xem tất cả chi nhánh) → lấy role đầu tiên của user
      userBranchRole = await this.userBranchRoleRepo.findOne({
        where: { userId: resolvedUserId, isActive: true },
        relations: ['role', 'role.permissions'],
        order: { createdAt: 'ASC' },
      });
    }

    if (!userBranchRole) {
      this.logger.warn(`No role found for user ${user?.email}`);
      throw new ForbiddenException('Bạn chưa được phân quyền vào chi nhánh nào');
    }

    // Admin role bypass
    if (userBranchRole.role.name === 'Admin') {
      return true;
    }

    const userPermissions = userBranchRole.role.permissions.map((p: any) => p.name);
    // OR logic: chỉ cần có ít nhất 1 trong các quyền được khai báo
    const hasPermission = requiredPermissions.some(permission => userPermissions.includes(permission));

    if (!hasPermission) {
      throw new ForbiddenException('Bạn không có quyền thực hiện hành động này');
    }

    return true;
  }
}
