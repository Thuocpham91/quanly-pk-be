import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CreateOrderDto } from './dto/order.dto';
import { InventoryService } from '../inventory/inventory.service';
import { Customer } from '../customers/entities/customer.entity';
import { UserBranchRole } from '../branches/entities/user-branch-role.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
    @InjectRepository(UserBranchRole)
    private readonly userBranchRoleRepository: Repository<UserBranchRole>,
    private readonly inventoryService: InventoryService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(createOrderDto: CreateOrderDto, branchId: string, userId: string): Promise<Order> {
    if (!createOrderDto.items || createOrderDto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    if (!branchId) {
      throw new BadRequestException('Branch ID is required. Please select a branch before creating an order.');
    }

    if (!userId) {
      throw new BadRequestException('User ID is required.');
    }

    // Calculate totals
    let subTotal = 0;
    const orderItems: OrderItem[] = [];

    for (const itemDto of createOrderDto.items) {
      const totalPrice = itemDto.quantity * itemDto.unitPrice;
      subTotal += totalPrice;

      const orderItem = this.orderItemsRepository.create({
        productId: itemDto.productId,
        quantity: itemDto.quantity,
        unitPrice: itemDto.unitPrice,
        totalPrice: totalPrice,
      });
      orderItems.push(orderItem);
    }

    const discount = createOrderDto.discount || 0;
    const totalAmount = subTotal - discount;
    const walletCreditAmount = Number(createOrderDto.walletCreditAmount) || 0;

    // Generate Order Code globally for the current month/year to prevent unique key constraint conflicts across branches
    const yearMonth = `${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}`;
    const latestOrder = await this.ordersRepository.createQueryBuilder('order')
      .where('order.orderCode LIKE :prefix', { prefix: `ORD-${yearMonth}-%` })
      .orderBy('order.orderCode', 'DESC')
      .getOne();

    let nextNumber = 1;
    if (latestOrder) {
      const parts = latestOrder.orderCode.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }
    const orderCode = `ORD-${yearMonth}-${nextNumber.toString().padStart(4, '0')}`;

    const order = this.ordersRepository.create({
      orderCode,
      branchId,
      createdById: userId,
      customerId: createOrderDto.customerId,
      petId: createOrderDto.petId,
      subTotal,
      discount,
      totalAmount,
      walletCreditAmount,
      status: createOrderDto.status || OrderStatus.COMPLETED,
      paymentMethod: createOrderDto.paymentMethod,
      notes: createOrderDto.notes,
      items: orderItems,
    });

    const savedOrder = await this.ordersRepository.save(order);

    // Deduct inventory for completed orders
    if (savedOrder.status === OrderStatus.COMPLETED) {
      for (const item of savedOrder.items) {
        await this.inventoryService.deductStock(
          item.productId,
          branchId,
          item.quantity,
          savedOrder.orderCode,
          userId,
        );
      }
    }

    // Auto top-up customer wallet if walletCreditAmount > 0
    if (walletCreditAmount > 0 && createOrderDto.customerId) {
      const customer = await this.customersRepository.findOne({
        where: { id: createOrderDto.customerId },
      });
      if (customer) {
        const currentBalance = Number(customer.walletBalance) || 0;
        await this.customersRepository.update(customer.id, {
          walletBalance: currentBalance + walletCreditAmount,
        });
      }
    }

    // Gửi thông báo thời gian thực nếu người tạo là Nhân viên
    try {
      const creatorRole = await this.userBranchRoleRepository.findOne({
        where: { userId, branchId, isActive: true },
        relations: ['role', 'user'],
      });

      if (creatorRole && creatorRole.role.name === 'Nhân viên') {
        // Tìm tất cả quản lý thuộc chi nhánh này
        const branchManagers = await this.userBranchRoleRepository.find({
          where: { branchId, role: { name: 'Quản lý' }, isActive: true },
        });

        // Tìm tất cả admin trong hệ thống
        const admins = await this.userBranchRoleRepository.find({
          where: { role: { name: 'Admin' }, isActive: true },
        });

        // Kết hợp danh sách người nhận (loại bỏ trùng lặp)
        const recipientIds = new Set<string>();
        branchManagers.forEach((m) => recipientIds.add(m.userId));
        admins.forEach((a) => recipientIds.add(a.userId));

        // Loại bỏ chính người tạo khỏi danh sách nhận thông báo
        recipientIds.delete(userId);

        const creatorName = creatorRole.user?.fullName || 'Nhân viên';
        const orderMessage = `${creatorName} vừa tạo đơn hàng mới ${savedOrder.orderCode} trị giá ${savedOrder.totalAmount.toLocaleString('vi-VN')}đ`;

        for (const recipientId of recipientIds) {
          this.notificationsService.sendNotificationToUser(recipientId, {
            type: 'success',
            message: orderMessage,
            timestamp: new Date().toISOString(),
            data: {
              orderId: savedOrder.id,
              orderCode: savedOrder.orderCode,
            },
          });
        }
      }
    } catch (err) {
      console.error('Failed to trigger order creation notifications:', err);
    }

    return savedOrder;
  }

  async findAll(branchId: string, page = 1, limit = 10, petId?: string, customerId?: string, createdById?: string): Promise<{ data: Order[]; total: number }> {
    const where: any = {};
    if (branchId && branchId !== 'undefined' && branchId !== 'null') {
      where.branchId = branchId;
    }
    if (petId) {
      where.petId = petId;
    }
    if (customerId) {
      where.customerId = customerId;
    }
    // Lọc theo người tạo nếu không có quyền xem tất cả
    if (createdById) {
      where.createdById = createdById;
    }

    const [data, total] = await this.ordersRepository.findAndCount({
      where,
      relations: ['customer', 'createdBy', 'pet'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }

  async findOne(id: string, branchId?: string): Promise<Order> {
    const whereClause: any = { id };
    if (branchId && branchId !== 'undefined' && branchId !== 'null') {
      whereClause.branchId = branchId;
    }

    const order = await this.ordersRepository.findOne({
      where: whereClause,
      relations: ['customer', 'createdBy', 'pet', 'items', 'items.product'],
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
  }

  async updateStatus(id: string, branchId: string, status: OrderStatus, userId?: string): Promise<Order> {
    const order = await this.findOne(id, branchId);
    
    if (status === OrderStatus.COMPLETED && order.status !== OrderStatus.COMPLETED) {
      for (const item of order.items) {
        await this.inventoryService.deductStock(
          item.productId,
          branchId,
          item.quantity,
          order.orderCode,
          userId || order.createdById,
        );
      }
    }

    order.status = status;
    return this.ordersRepository.save(order);
  }
}
