import type { MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined'
import { Button, type ButtonProps } from '@mui/material'
import { buildSupportPrefill } from '@shared/lib/supportContext'

type Props = Omit<ButtonProps, 'children'> & {
    sectionName?: string
    datasetId?: string | null
    publicationId?: string | null
}

export const ReportProblemButton = ({
    sectionName,
    datasetId,
    publicationId,
    variant = 'outlined',
    size = 'small',
    onClick,
    ...buttonProps
}: Props) => {
    const navigate = useNavigate()
    const location = useLocation()

    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) {
            return
        }

        navigate('/support/new', {
            state: {
                supportPrefill: buildSupportPrefill({
                    sectionName,
                    search: location.search,
                    datasetId,
                    publicationId,
                }),
            },
        })
    }

    return (
        <Button
            variant={variant}
            size={size}
            startIcon={<BugReportOutlinedIcon />}
            onClick={handleClick}
            {...buttonProps}
        >
            Сообщить о проблеме
        </Button>
    )
}
