import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { User } from '../users/entities/user.entity';
import { Branch } from '../branches/entities/branch.entity';
import { UserBranchRole } from '../branches/entities/user-branch-role.entity';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/services/mail.service';

@Injectable()
export class PermissionsSeedService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Permission)
    private permissionRepo: Repository<Permission>,
    @InjectRepository(Role)
    private roleRepo: Repository<Role>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Branch)
    private branchRepo: Repository<Branch>,
    @InjectRepository(UserBranchRole)
    private ubrRepo: Repository<UserBranchRole>,
    private configService: ConfigService,
    private mailService: MailService,
  ) {}

  async onApplicationBootstrap() {
    console.log('--- STARTING PERMISSIONS & ADMIN SEED ---');
    try {
      await this.seedPermissions();
      await this.seedDefaultRoles();
      await this.seedAdminUser();
      console.log('--- SEEDING COMPLETED SUCCESSFULLY ---');
    } catch (error) {
      console.error('--- SEEDING FAILED ---', error);
    }
  }

  private async seedPermissions() {
    console.log('Seeding permissions...');
    const permissions = [

      // ══════════════════════════════════════
      // NHÓM: TỔNG QUAN
      // ══════════════════════════════════════
      { name: 'dashboard.view',        displayName: 'Bản điều khiển',         module: 'Tổng quan' },
      { name: 'customers.view',        displayName: 'Khách hàng',              module: 'Tổng quan' },
      { name: 'customers.create_edit', displayName: 'Thêm / Sửa khách hàng',  module: 'Tổng quan' },
      { name: 'customers.delete',      displayName: 'Xóa khách hàng',         module: 'Tổng quan' },
      { name: 'pets.view',             displayName: 'Thú cưng',                module: 'Tổng quan' },
      { name: 'pets.create_edit',      displayName: 'Thêm / Sửa thú cưng',    module: 'Tổng quan' },
      { name: 'pets.delete',           displayName: 'Xóa thú cưng',           module: 'Tổng quan' },
      { name: 'appointments.view',     displayName: 'Công việc',                module: 'Tổng quan' },
      { name: 'appointments.manage',   displayName: 'Thêm / Sửa công việc',    module: 'Tổng quan' },

      // ══════════════════════════════════════
      // NHÓM: NỘI TRÚ / CHUỒNG TRẠI (GỘP VÀO TỔNG QUAN)
      // ══════════════════════════════════════
      { name: 'boarding.view',          displayName: 'Xem nội trú',              module: 'Tổng quan' },
      { name: 'boarding.manage',        displayName: 'Thêm / Sửa nội trú',      module: 'Tổng quan' },
      { name: 'boarding.delete',        displayName: 'Xóa nội trú',             module: 'Tổng quan' },
      { name: 'boarding.payment',       displayName: 'Tạm ứng',                  module: 'Tổng quan' },
      { name: 'boarding.view_health',   displayName: 'Xem sức khỏe thú cưng',  module: 'Tổng quan' },
      { name: 'boarding.edit_health',   displayName: 'Cập nhật sức khỏe',       module: 'Tổng quan' },
      { name: 'boarding.checkout',      displayName: 'Trả thú cưng',            module: 'Tổng quan' },
      { name: 'boarding.view_history',  displayName: 'Lịch sử nội trú',          module: 'Tổng quan' },

      // ══════════════════════════════════════
      // NHÓM: BÁN HÀNG
      // ══════════════════════════════════════
      { name: 'sales.create',       displayName: 'Bán hàng (POS)',              module: 'Bán hàng' },
      { name: 'sales.edit_price',   displayName: 'Sửa đơn giá',                module: 'Bán hàng' },
      { name: 'sales.edit_discount',displayName: 'Sửa giảm giá',               module: 'Bán hàng' },
      { name: 'sales.edit_date',    displayName: 'Sửa ngày bán',               module: 'Bán hàng' },
      { name: 'sales.edit_seller',  displayName: 'Sửa người bán',              module: 'Bán hàng' },
      { name: 'sales.payment',      displayName: 'Thanh toán',                 module: 'Bán hàng' },
      { name: 'sales.exam',         displayName: 'Khám bệnh',                  module: 'Bán hàng' },
      { name: 'sales.print_draft',  displayName: 'In tạm',                     module: 'Bán hàng' },
      { name: 'sales.sell_expired', displayName: 'Bán sản phẩm hết hạn',      module: 'Bán hàng' },
      { name: 'sales.view_others',  displayName: 'Xem đơn của người khác',    module: 'Bán hàng' },
      { name: 'history.view',       displayName: 'Lịch sử đơn hàng',          module: 'Bán hàng' },
      { name: 'history.view_others',displayName: 'Xem lịch sử người khác',    module: 'Bán hàng' },
      { name: 'history.edit_order', displayName: 'Sửa đơn hàng',              module: 'Bán hàng' },
      { name: 'history.cancel_order',displayName: 'Hủy đơn hàng',            module: 'Bán hàng' },
      { name: 'history.delete_draft',displayName: 'Xóa đơn lưu tạm',         module: 'Bán hàng' },

      // ══════════════════════════════════════
      // NHÓM: KHO HÀNG
      // ══════════════════════════════════════
      { name: 'products.view',             displayName: 'Hàng hóa / Dịch vụ',      module: 'Kho hàng' },
      { name: 'products.create_edit',      displayName: 'Thêm / Sửa hàng hóa',     module: 'Kho hàng' },
      { name: 'products.delete',           displayName: 'Xóa hàng hóa',            module: 'Kho hàng' },
      { name: 'products.manage_price',     displayName: 'Quản lý giá',             module: 'Kho hàng' },
      { name: 'inventory.view',            displayName: 'Xem kho hàng',            module: 'Kho hàng' },
      { name: 'inventory.import',          displayName: 'Nhập hàng',               module: 'Kho hàng' },
      { name: 'inventory.edit_import',     displayName: 'Sửa đơn nhập hàng',      module: 'Kho hàng' },
      { name: 'inventory.cancel_import',   displayName: 'Hủy đơn nhập hàng',      module: 'Kho hàng' },
      { name: 'inventory.stocktake',       displayName: 'Kiểm kho',                module: 'Kho hàng' },
      { name: 'inventory.transfer',        displayName: 'Xuất & Chuyển kho',       module: 'Kho hàng' },
      { name: 'inventory.view_history',    displayName: 'Biến động kho',           module: 'Kho hàng' },
      { name: 'distributors.view',         displayName: 'Nhà phân phối',           module: 'Kho hàng' },
      { name: 'distributors.manage',       displayName: 'Thêm / Sửa nhà phân phối',module: 'Kho hàng' },

      // ══════════════════════════════════════
      // NHÓM: HỆ THỐNG
      // ══════════════════════════════════════
      { name: 'users.view',       displayName: 'Xem nhân viên',       module: 'Hệ thống' },
      { name: 'users.manage',     displayName: 'Phân quyền nhân viên',module: 'Hệ thống' },
      { name: 'branches.view',    displayName: 'Xem chi nhánh',       module: 'Hệ thống' },
      { name: 'branches.manage',  displayName: 'Quản lý chi nhánh',   module: 'Hệ thống' },
      { name: 'settings.view',    displayName: 'Cấu hình hệ thống',   module: 'Hệ thống' },
      { name: 'settings.manage',  displayName: 'Chỉnh sửa cấu hình', module: 'Hệ thống' },
    ];

    for (const p of permissions) {
      const exists = await this.permissionRepo.findOne({
        where: { name: p.name },
      });
      if (!exists) {
        await this.permissionRepo.save(this.permissionRepo.create(p));
      } else {
        exists.displayName = p.displayName;
        exists.module = p.module;
        await this.permissionRepo.save(exists);
      }
    }
  }

  private async seedDefaultRoles() {
    console.log('Seeding default roles...');

    // Migrate tên cũ → tên mới nếu tồn tại
    const migrations = [
      { oldName: 'Vet', newName: 'Quản lý', description: 'Quản lý chi nhánh' },
      { oldName: 'Receptionist', newName: 'Nhân viên', description: 'Nhân viên phòng khám' },
    ];
    for (const m of migrations) {
      const old = await this.roleRepo.findOne({ where: { name: m.oldName } });
      if (old) {
        old.name = m.newName;
        old.description = m.description;
        await this.roleRepo.save(old);
        console.log(`Migrated role: ${m.oldName} → ${m.newName}`);
      }
    }

    const defaultRoles = [
      { name: 'Admin',    description: 'Toàn quyền hệ thống' },
      { name: 'Quản lý', description: 'Quản lý chi nhánh' },
      { name: 'Nhân viên', description: 'Nhân viên phòng khám' },
    ];

    const allPermissions = await this.permissionRepo.find();

    // Permissions mặc định cho Quản lý (quản lý chi nhánh, trừ phân quyền hệ thống cấp cao)
    const quanLyPerms = [
      'dashboard.view',
      'customers.view', 'customers.delete',
      'pets.view', 'pets.delete',
      'appointments.view', 'appointments.manage',
      'boarding.view', 'boarding.manage', 'boarding.payment', 'boarding.view_health', 'boarding.edit_health', 'boarding.checkout', 'boarding.view_history', 'boarding.delete',
      'sales.create', 'sales.edit_date', 'sales.edit_discount',
      'sales.edit_price', 'sales.payment', 'sales.exam',
      'sales.view_others', 'sales.sell_expired', 'sales.print_draft', 'sales.edit_seller',
      'history.view', 'history.view_others', 'history.edit_order',
      'history.view_exams', 'history.edit_exam', 'history.view_vaccines', 'history.edit_vaccine',
      'history.cancel_order', 'history.delete_draft', 'history.view_grooming', 'history.edit_grooming',
      'history.view_boarding',
      'products.view', 'products.create_edit', 'products.delete',
      'inventory.import', 'inventory.edit_import', 'inventory.cancel_import', 'inventory.view_recent_cost',
      'debts.suppliers', 'debts.customers', 'debts.edit_date',
      'advances.manage',
      'users.view',
      'branches.view',
      'settings.view', 'settings.manage',
    ];

    // Permissions mặc định cho Nhân viên (chỉ thao tác cơ bản hàng ngày)
    const nhanVienPerms = [
      'dashboard.view',
      'customers.view',
      'pets.view',
      'appointments.view', 'appointments.manage',
      'boarding.view', 'boarding.manage', 'boarding.view_health',
      'sales.create', 'sales.payment', 'sales.exam', 'sales.print_draft',
      'history.view', 'history.view_exams', 'history.view_vaccines',
      'history.view_grooming', 'history.view_boarding',
      'products.view',
    ];

    for (const r of defaultRoles) {
      const exists = await this.roleRepo.findOne({
        where: { name: r.name },
        relations: ['permissions'],
      });
      if (!exists) {
        const role = this.roleRepo.create(r);
        if (r.name === 'Admin') {
          role.permissions = allPermissions;
        } else if (r.name === 'Quản lý') {
          role.permissions = allPermissions.filter(p => quanLyPerms.includes(p.name));
        } else if (r.name === 'Nhân viên') {
          role.permissions = allPermissions.filter(p => nhanVienPerms.includes(p.name));
        }
        await this.roleRepo.save(role);
      } else if (r.name === 'Admin') {
        // Admin luôn có tất cả permissions (kể cả permissions mới thêm)
        exists.permissions = allPermissions;
        await this.roleRepo.save(exists);
        console.log('Updated Admin role with all permissions');
      }
      // Quản lý & Nhân viên: KHÔNG tự động override sau khi tạo lần đầu
      // (để không ghi đè khi admin đã tùy chỉnh qua UI)
    }
  }

  private async seedAdminUser() {
    console.log('Seeding admin user...');
    const email = 'admin@gmail.com';
    let admin = await this.userRepo.findOne({ where: { email } });

    const adminPassword = this.configService.get<string>('ADMIN_PASSWORD');

    if (!admin) {
      const rawPassword = adminPassword || Math.random().toString(36).slice(-8);
      const hashedPassword = await bcrypt.hash(rawPassword, 10);
      admin = await this.userRepo.save(
        this.userRepo.create({
          email,
          password: hashedPassword,
          fullName: 'Default Admin',
          isActive: true,
        }),
      );
      console.log(`Created admin user: ${email}`);
      if (adminPassword) {
        console.log('ADMIN_PASSWORD is set in environment; admin password has been configured.');
      }
    } else if (adminPassword) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      admin.password = hashedPassword;
      await this.userRepo.save(admin);
      console.log('ADMIN_PASSWORD is set in environment; existing admin password has been updated.');

      const notifyEmail = this.configService.get<string>('ADMIN_NOTIFY_EMAIL');
      if (notifyEmail) {
        try {
          const loginUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
          await this.mailService.sendAdminCredentials(notifyEmail, {
            email: email,
            password: adminPassword,
            loginUrl,
          });
          console.log(`Sent generated admin credentials to ${notifyEmail}`);
        } catch (error) {
          console.error(`Failed to send credentials to ${notifyEmail}:`, error);
        }
      } else {
        console.warn('ADMIN_NOTIFY_EMAIL is not set in .env. Password generated but not emailed.');
        console.log(`[DEV ONLY] Admin Password: ${adminPassword}`);
      }
    }

    const adminRole = await this.roleRepo.findOne({ where: { name: 'Admin' } });
    const branches = await this.branchRepo.find();

    if (adminRole && branches.length > 0) {
      for (const branch of branches) {
        const exists = await this.ubrRepo.findOne({
          where: { userId: admin.id, branchId: branch.id },
        });

        if (!exists) {
          await this.ubrRepo.save(
            this.ubrRepo.create({
              userId: admin.id,
              branchId: branch.id,
              roleId: adminRole.id,
            }),
          );
          console.log(
            `Assigned Admin role to ${email} in branch: ${branch.name}`,
          );
        }
      }
    }
  }
}
