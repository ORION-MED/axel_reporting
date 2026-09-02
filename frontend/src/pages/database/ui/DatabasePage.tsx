import { useNavigate } from 'react-router-dom'
import {
    Box,
    Typography,
    Card,
    CardContent,
    CardActionArea,
    Chip,
    Stack,
} from '@mui/material'
import StorageIcon from '@mui/icons-material/Storage'

interface DbCard {
    id: string
    title: string
    version: string
    description: string
    tables: number
    status: 'available' | 'coming-soon'
    route: string
}

const DATABASES: DbCard[] = [
    {
        id: 'eicu',
        title: 'eICU-CRD',
        version: '2.0',
        description:
            'eICU Collaborative Research Database — мультицентровая база данных ICU с ~200 000 госпитализаций из 208 больниц США.',
        tables: 31,
        status: 'available',
        route: '/database/eicu',
    },
    {
        id: 'mimic',
        title: 'MIMIC-IV',
        version: '3.1',
        description:
            'Medical Information Mart for Intensive Care — данные пациентов Beth Israel Deaconess Medical Center.',
        tables: 26,
        status: 'available',
        route: '/database/mimic',
    },
    {
        id: 'picdb',
        title: 'PICDB',
        version: '1.0',
        description:
            'Paediatric Intensive Care Database — неонатальные и педиатрические данные ICU.',
        tables: 13,
        status: 'available',
        route: '/database/picdb',
    },
]

// Функция DatabasePage

export const DatabasePage = () => {
    const navigate = useNavigate()

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            <Typography variant="h5" gutterBottom>
                Базы данных
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Выберите базу данных для исследования когорт и анализа данных.
            </Typography>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                {DATABASES.map((db) => (
                    <Card
                        key={db.id}
                        variant="outlined"
                        sx={{
                            flex: 1,
                            opacity: db.status === 'coming-soon' ? 0.55 : 1,
                            transition: 'box-shadow 0.2s',
                            '&:hover': db.status === 'available'
                                ? { boxShadow: 4 }
                                : undefined,
                        }}
                    >
                        <CardActionArea
                            disabled={db.status === 'coming-soon'}
                            onClick={() => navigate(db.route)}
                            sx={{ height: '100%' }}
                        >
                            <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <StorageIcon color="primary" />
                                    <Typography variant="h6">{db.title}</Typography>
                                    <Chip
                                        label={`v${db.version}`}
                                        size="small"
                                        color="primary"
                                        variant="outlined"
                                    />
                                </Box>

                                <Typography variant="body2" color="text.secondary">
                                    {db.description}
                                </Typography>

                                <Box sx={{ display: 'flex', gap: 1, mt: 'auto' }}>
                                    <Chip
                                        label={`${db.tables} таблиц`}
                                        size="small"
                                        variant="outlined"
                                    />
                                    <Chip
                                        label={db.status === 'available' ? 'Доступна' : 'Скоро'}
                                        size="small"
                                        color={db.status === 'available' ? 'success' : 'default'}
                                    />
                                </Box>
                            </CardContent>
                        </CardActionArea>
                    </Card>
                ))}
            </Stack>
        </Box>
    )
}
