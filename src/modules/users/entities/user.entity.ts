import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserBranchRole } from '../../branches/entities/user-branch-role.entity';

export enum Gender {
  MALE = 'Nam',
  FEMALE = 'Nữ',
  OTHER = 'Khác',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column()
  fullName: string;

  @Column({ type: 'enum', enum: Gender, nullable: true })
  gender: Gender;

  @Column({ type: 'date', nullable: true })
  dateOfBirth: Date;

  @Column({ nullable: true })
  idCard: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ type: 'date', nullable: true })
  hireDate: Date;

  @Column({ type: 'text', nullable: true })
  specialties: string;

  @Column({ default: false })
  englishProficiency: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  fcmToken: string;

  @OneToMany(() => UserBranchRole, (ubr) => ubr.user)
  userBranchRoles: UserBranchRole[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
