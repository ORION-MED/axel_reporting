import { Transform } from 'class-transformer'
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

const trimRequired = ({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value
    return value.trim()
}

const trimOptional = ({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

export const SUPPORT_CATEGORIES = [
    'Авторизация и доступ',
    'Загрузка данных',
    'Фильтрация данных',
    'Обработка данных',
    'Временные ряды',
    'Статистика',
    'Визуализация и дашборды',
    'Публикации и экспорт',
    'Ошибка интерфейса',
    'Общий вопрос / Консультация',
] as const
export const SUPPORT_PRIORITIES = ['Низкий', 'Средний', 'Высокий', 'Критический', 'LOW', 'MEDIUM', 'HIGH'] as const

export class CreateSupportTicketDto {
    @Transform(trimOptional)
    @IsOptional()
    @IsString()
    @MaxLength(120)
    name?: string

    @Transform(trimRequired)
    @IsEmail({}, { message: 'email должен быть корректным адресом почты' })
    email: string

    @Transform(trimRequired)
    @IsString()
    @IsNotEmpty({ message: 'category обязателен' })
    @IsIn([...SUPPORT_CATEGORIES], { message: 'category имеет недопустимое значение' })
    category: string

    @Transform(trimRequired)
    @IsString()
    @IsNotEmpty({ message: 'priority обязателен' })
    @IsIn([...SUPPORT_PRIORITIES], { message: 'priority имеет недопустимое значение' })
    priority: string

    @Transform(trimRequired)
    @IsString()
    @IsNotEmpty({ message: 'subject обязателен' })
    @MaxLength(200)
    subject: string

    @Transform(trimRequired)
    @IsString()
    @IsNotEmpty({ message: 'description обязателен' })
    @MaxLength(10000)
    description: string

    @Transform(trimOptional)
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    stepsToReproduce?: string

    @Transform(trimOptional)
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    expectedResult?: string

    @Transform(trimOptional)
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    actualResult?: string

    @Transform(trimOptional)
    @IsOptional()
    @IsString()
    @MaxLength(200)
    sectionName?: string

    @Transform(trimOptional)
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    pageUrl?: string

    @Transform(trimOptional)
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    browserInfo?: string

    @Transform(trimOptional)
    @IsOptional()
    @IsString()
    @MaxLength(120)
    datasetId?: string

    @Transform(trimOptional)
    @IsOptional()
    @IsString()
    @MaxLength(120)
    publicationId?: string
}
