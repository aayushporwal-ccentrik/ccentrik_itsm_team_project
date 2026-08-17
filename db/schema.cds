namespace itsm;
 
using { cuid, managed } from '@sap/cds/common';
 
context transaction {
 
    entity Ticket : managed {
 
        key ticketID     : String;
 
        ticketNumber     : String;
        ticketType       : String;
 
        shortDescription : String;
        description      : String;
        status           : String;
        subStatus        : String;
        priority         : String;

        reportedBy       : String;
        createdByName     : String;
        createdByLocation : String;
        orgName           : String;
        messageProcessor : String;
        supportTeam      : String;

        // Read-only link to the reporting user, purely so the client's
        // company can be shown/filtered on — reportedBy itself stays the
        // plain username it always was.
        reportedByUser : Association to master.User
            on reportedByUser.userId = reportedBy;

        firstResponseAt  : Timestamp;
        dueAt            : Timestamp;
        completedAt      : Timestamp;
        assignedAt       : Timestamp;
 
        incidentForm : Composition of one IncidentForm
            on incidentForm.ticketID = $self.ticketID;
           
        attachments : Composition of many Attachment
            on attachments.ticketID = $self.ticketID;

        ticketLogs : Composition of many TicketLog
            on ticketLogs.ticketID = $self.ticketID;
    }
 
    entity IncidentForm : cuid {
 
        ticketID : String;
 
        description : LargeString;
 
        category1 : String;
        category2 : String;
        category3 : String;
        category4 : String;
 
        impact : String;
        urgency : String;
        recommendedPriority : String;
        configurationItem : String;
    }
 
    entity Attachment : cuid, managed {
 
        @Core.ContentDisposition.Filename : fileName
        @Core.MediaType : mediaType
        content : LargeBinary;
 
        ticketID : String;
 
        mediaType   : String;
        fileName    : String;
        fileSize    : Integer;
        storagePath : String;
    }

    entity TicketLog : cuid, managed {
    ticketID        : String;
    stage           : String;
    status          : String;
    userName        : String;
    userEmail       : String;
    role            : String;
    receivedDt      : DateTime;
    completionDt    : DateTime;
    pendingWith     : String;
    pendingWithName : String;
    remarks         : String(4000);
    }
}
 
context master {
 
    entity LookupValue : cuid, managed {
 
        lookupType  : String;
        code        : String;
        name        : String;
        description : String;
        sequence    : Integer;
        isDefault   : Boolean;
        isActive    : Boolean;
    }
 
    entity TicketCounter : managed {
        key type : String;
        lastNumber : Integer;
    }
 
    entity User : cuid, managed {
        userId   : String;
        name     : String;
        email    : String;
        isActive : Boolean;
        role     : String;
        client   : String;
    }

    entity Organization : cuid, managed {
        code              : String(20);
        name              : String(100);
        isActive          : Boolean default true;
        themeType         : String(20) default 'SOLID';      // 'SOLID' | 'GRADIENT'
        themeScope        : String(20) default 'HEADER';     // 'HEADER' (header strip + buttons only) | 'BACKGROUND' (whole page canvas, cards/tables stay white)
        primaryColor      : String(20);
        secondaryColor    : String(20);
        gradientDirection : String(20) default 'TOP_BOTTOM'; // fixed by spec, not user-editable
        logo              : String(500);                     // effective logo URL shown to end users — points at logoContent below once uploaded, or an admin-pasted external URL

        @Core.ContentDisposition.Filename : logoFileName
        @Core.MediaType : logoMediaType
        logoContent   : LargeBinary; // set when the admin uploads a file directly, same media-stream mechanism as Attachment.content
        logoFileName  : String;
        logoMediaType : String;
    }

    entity OrganizationSLA : cuid, managed {

        organizationId   : String;
        organizationName : String;

        impact           : String;
        urgency          : String;
        impactedUserFrom : Integer;
        impactedUserTo   : Integer;
        priority         : String;
        firstResponseMinutes : Integer;
        resolutionMinutes    : Integer;

        isActive : Boolean;
    }
}
 
 