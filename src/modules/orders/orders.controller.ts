import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Put,
  UseGuards,
  Request,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { OrderStatus } from './entities/order.entity';
import { UserBranchRole } from '../branches/entities/user-branch-role.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    @InjectRepository(UserBranchRole)
    private readonly ubrRepo: Repository<UserBranchRole>,
  ) {}

  @Post()
  @Permissions('sales.create')
  create(@Request() req, @Body() createOrderDto: CreateOrderDto) {
    const branchId = req.headers['x-branch-id'];
    const userId = req.user.userId;
    return this.ordersService.create(createOrderDto, branchId, userId);
  }

  @Get()
  @Permissions('history.view')
  async findAll(
    @Request() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('petId') petId?: string,
    @Query('customerId') customerId?: string,
  ) {
    const branchId = req.headers['x-branch-id'];
    const userId = req.user.userId || req.user.id || req.user.sub;

    // Kiểm tra xem user có quyền xem tất cả không
    const ubr = await this.ubrRepo.findOne({
      where: { userId, branchId: branchId || undefined, isActive: true },
      relations: ['role', 'role.permissions'],
      order: { createdAt: 'ASC' },
    });
    const userPerms = ubr?.role?.permissions?.map((p: any) => p.name) || [];
    const isAdmin =
      req.user.email?.toLowerCase() === 'admin@gmail.com' ||
      ubr?.role?.name === 'Admin';
    const viewAll = isAdmin || userPerms.includes('history.view_others');

    return this.ordersService.findAll(
      branchId,
      page,
      limit,
      petId,
      customerId,
      viewAll ? undefined : userId,
    );
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    const branchId = req.headers['x-branch-id'];
    return this.ordersService.findOne(id, branchId);
  }

  @Put(':id/status')
  updateStatus(
    @Request() req,
    @Param('id') id: string,
    @Body('status') status: OrderStatus,
  ) {
    const branchId = req.headers['x-branch-id'];
    const userId = req.user.userId;
    return this.ordersService.updateStatus(id, branchId, status, userId);
  }
}
